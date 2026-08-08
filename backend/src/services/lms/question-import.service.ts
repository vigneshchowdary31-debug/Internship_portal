import prisma from '../../config/db';
import { AppError } from '../../utils/AppError';
import { CsvParseError, parseCsvTable, toCsv, normaliseHeader } from '../../utils/csv';

/**
 * Bulk question import from CSV.
 *
 * Reuses `parseCsvTable` — the same parser the user import uses, with the same
 * quoting rules, the same case-insensitive header matching and the same
 * "extra columns are ignored" behaviour. A second CSV parser in one codebase is
 * two sets of edge cases around embedded commas and quotes, and they diverge.
 *
 * Validation is per row and partial success is the norm: an admin who pasted
 * forty questions and got one option wrong should get thirty-nine in and a
 * report on the fortieth, not a rejection of the lot.
 */

/** The documented column set. Extra columns are ignored by the parser. */
export const QUESTION_CSV_HEADERS = [
  'question',
  'option1',
  'option2',
  'option3',
  'option4',
  'correctOption',
  'marks',
];

/**
 * Row cap. The route's body limit bounds bytes; this bounds work.
 *
 * Well above any realistic paper, and low enough that one request cannot open a
 * transaction of thousands of inserts.
 */
export const MAX_IMPORT_ROWS = 200;

/** Optional columns beyond option1/2 — the format allows up to four. */
const OPTION_KEYS = ['option1', 'option2', 'option3', 'option4'];

export interface RejectedRow {
  /** 1-based line in the source file, so an admin can find it in their editor. */
  row: number;
  question: string;
  reason: string;
}

export interface ImportResult {
  totalRows: number;
  imported: number;
  failed: number;
  rejected: RejectedRow[];
}

interface ParsedQuestion {
  question: string;
  options: string[];
  correctAnswer: string;
  marks: number;
}

export class QuestionImportService {
  /** A ready-to-fill file, so nobody has to guess the header spelling. */
  static template(): string {
    return toCsv(QUESTION_CSV_HEADERS, [
      [
        'What does the useEffect hook do?',
        'Runs side effects after render',
        'Creates a database connection',
        'Compiles JSX',
        'Defines a CSS class',
        1,
        2,
      ],
      ['Which keyword declares a constant?', 'let', 'const', 'var', '', 2, 1],
    ]);
  }

  /**
   * Validates one row into a question, or explains why it cannot be one.
   *
   * Returns a reason rather than throwing, because every row is judged
   * independently and one bad row must not end the import.
   */
  private static parseRow(record: Record<string, string>): ParsedQuestion | { reason: string } {
    const question = (record[normaliseHeader('question')] ?? '').trim();
    if (!question) return { reason: 'The question text is empty.' };

    // Options are positional: a blank option3 with a filled option4 would make
    // "correctOption 4" ambiguous, so gaps are rejected rather than compacted.
    const raw = OPTION_KEYS.map((key) => (record[normaliseHeader(key)] ?? '').trim());
    const firstBlank = raw.findIndex((o) => !o);
    const filled = firstBlank === -1 ? raw : raw.slice(0, firstBlank);

    if (firstBlank !== -1 && raw.slice(firstBlank).some((o) => o)) {
      return { reason: 'Options must be filled left to right — option3 is blank but option4 is not.' };
    }
    if (filled.length < 2) return { reason: 'At least two options are required.' };
    if (new Set(filled).size !== filled.length) return { reason: 'Options must be distinct.' };

    const correctRaw = (record[normaliseHeader('correctOption')] ?? '').trim();
    const correctIndex = Number(correctRaw);
    if (!correctRaw) return { reason: 'correctOption is missing.' };
    if (!Number.isInteger(correctIndex)) {
      return { reason: `correctOption must be a whole number, not "${correctRaw}".` };
    }
    if (correctIndex < 1 || correctIndex > filled.length) {
      return {
        reason: `correctOption is ${correctIndex}, but this row has ${filled.length} option(s).`,
      };
    }

    // `marks` is optional and defaults to 1 — most papers are one mark a
    // question, and requiring the column would reject a perfectly good file.
    const marksRaw = (record[normaliseHeader('marks')] ?? '').trim();
    let marks = 1;
    if (marksRaw) {
      marks = Number(marksRaw);
      if (!Number.isInteger(marks) || marks < 1 || marks > 100) {
        return { reason: `marks must be a whole number between 1 and 100, not "${marksRaw}".` };
      }
    }

    return {
      question,
      options: filled,
      // Stored as the option's VALUE, matching how the server marks
      // (`answers[qid] === correctAnswer`) and how the manual builder writes it.
      correctAnswer: filled[correctIndex - 1],
      marks,
    };
  }

  /**
   * Imports questions into a quiz.
   *
   * The attempt check happens FIRST and refuses the whole file: adding to a
   * quiz people have already sat changes what a later attempt is out of, and
   * partial success on that would be worse than none. QuizService.addQuestion
   * enforces the identical rule per question; the message is kept word for word
   * so an admin meets one explanation, not two.
   */
  static async importForQuiz(quizId: string, csv: string): Promise<ImportResult> {
    const quiz = await prisma.quiz.findUnique({
      where: { id: quizId },
      select: { id: true, _count: { select: { attempts: true, questions: true } } },
    });
    if (!quiz) throw new AppError('Quiz not found', 404);

    if (quiz._count.attempts > 0) {
      throw new AppError(
        `This quiz has already been attempted ${quiz._count.attempts} time(s), so its questions can no longer be changed. Create a new quiz instead.`,
        409
      );
    }

    let table;
    try {
      table = parseCsvTable(csv, QUESTION_CSV_HEADERS);
    } catch (error) {
      // A malformed header or an empty file is a problem with the FILE, not
      // with a row — the caller gets one clear message rather than N.
      if (error instanceof CsvParseError) throw new AppError(error.message, 400);
      throw error;
    }

    if (table.rows.length > MAX_IMPORT_ROWS) {
      throw new AppError(
        `That file has ${table.rows.length} rows. Import at most ${MAX_IMPORT_ROWS} questions at a time.`,
        400
      );
    }

    const accepted: ParsedQuestion[] = [];
    const rejected: RejectedRow[] = [];

    table.rows.forEach((record, index) => {
      const parsed = this.parseRow(record);
      if ('reason' in parsed) {
        rejected.push({
          row: table.rowNumbers[index],
          question: (record[normaliseHeader('question')] ?? '').slice(0, 120),
          reason: parsed.reason,
        });
        return;
      }
      accepted.push(parsed);
    });

    if (accepted.length > 0) {
      // Positions continue after whatever is already there, so an import adds
      // to a hand-built paper rather than colliding with it.
      const last = await prisma.question.findFirst({
        where: { quizId },
        orderBy: { position: 'desc' },
        select: { position: true },
      });
      const startAt = (last?.position ?? -1) + 1;

      // One statement for the whole file. The per-row loop this replaces was
      // the N+1 a 200-question import would otherwise ship with.
      await prisma.question.createMany({
        data: accepted.map((q, index) => ({
          quizId,
          question: q.question,
          options: q.options,
          correctAnswer: q.correctAnswer,
          marks: q.marks,
          position: startAt + index,
        })),
      });
    }

    return {
      totalRows: table.rows.length,
      imported: accepted.length,
      failed: rejected.length,
      rejected,
    };
  }

  /** The rejected rows as a CSV an admin can fix and re-upload. */
  static rejectedToCsv(rejected: RejectedRow[]): string {
    return toCsv(
      ['row', 'question', 'reason'],
      rejected.map((r) => [r.row, r.question, r.reason])
    );
  }
}
