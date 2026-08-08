import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPrismaMock, type PrismaMock } from '../../test/prismaMock';

const prismaMock: PrismaMock = createPrismaMock();
vi.mock('../../config/db', () => ({ default: prismaMock }));

const { QuestionImportService, MAX_IMPORT_ROWS } = await import('./question-import.service');

const HEADER = 'question,option1,option2,option3,option4,correctOption,marks';
const csv = (...rows: string[]) => [HEADER, ...rows].join('\n');

const quiz = (attempts = 0, questions = 0) => ({
  id: 'q1',
  _count: { attempts, questions },
});

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.quiz.findUnique.mockResolvedValue(quiz());
  prismaMock.question.findFirst.mockResolvedValue(null);
  prismaMock.question.createMany.mockResolvedValue({ count: 0 });
});

// --- The attempt guard -------------------------------------------------------

describe('a quiz that has been attempted refuses the whole file', () => {
  it('rejects the import outright', async () => {
    prismaMock.quiz.findUnique.mockResolvedValue(quiz(4));

    // Partial success on a sat quiz would change what a later attempt is out
    // of — worse than refusing, so this is the one all-or-nothing rule.
    await expect(
      QuestionImportService.importForQuiz('q1', csv('Q1,a,b,,,1,1'))
    ).rejects.toThrow(/already been attempted 4 time/);
  });

  it('writes nothing', async () => {
    prismaMock.quiz.findUnique.mockResolvedValue(quiz(1));

    await expect(QuestionImportService.importForQuiz('q1', csv('Q1,a,b,,,1,1'))).rejects.toThrow();
    expect(prismaMock.question.createMany).not.toHaveBeenCalled();
  });

  it('404s an unknown quiz before parsing anything', async () => {
    prismaMock.quiz.findUnique.mockResolvedValue(null);

    await expect(QuestionImportService.importForQuiz('nope', csv('Q1,a,b,,,1,1'))).rejects.toThrow(
      'Quiz not found'
    );
  });
});

// --- File-level problems -----------------------------------------------------

describe('a broken file is one error, not N', () => {
  it('rejects a missing header column', async () => {
    await expect(
      QuestionImportService.importForQuiz('q1', 'question,option1\nQ1,a')
    ).rejects.toThrow(/missing required column/);
  });

  it('rejects a header row with no data', async () => {
    await expect(QuestionImportService.importForQuiz('q1', HEADER)).rejects.toThrow(
      /no data rows/
    );
  });

  it('rejects a file over the row cap', async () => {
    const rows = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => `Q${i},a,b,,,1,1`);

    await expect(QuestionImportService.importForQuiz('q1', csv(...rows))).rejects.toThrow(
      new RegExp(`at most ${MAX_IMPORT_ROWS} questions`)
    );
  });
});

// --- Row validation ----------------------------------------------------------

describe('valid rows import', () => {
  it('maps correctOption from a 1-based INDEX to the option text', async () => {
    await QuestionImportService.importForQuiz('q1', csv('What is JSX?,Syntax,Database,,,1,2'));

    const [row] = prismaMock.question.createMany.mock.calls[0]![0].data;
    // The server marks by comparing VALUES, so the index has to be resolved.
    expect(row).toMatchObject({
      question: 'What is JSX?',
      options: ['Syntax', 'Database'],
      correctAnswer: 'Syntax',
      marks: 2,
    });
  });

  it('resolves an index pointing at a later option', async () => {
    await QuestionImportService.importForQuiz('q1', csv('Q,a,b,c,d,3,1'));

    expect(prismaMock.question.createMany.mock.calls[0]![0].data[0].correctAnswer).toBe('c');
  });

  it('defaults marks to 1 when the column is blank', async () => {
    await QuestionImportService.importForQuiz('q1', csv('Q,a,b,,,1,'));

    // Most papers are one mark a question; requiring it would reject good files.
    expect(prismaMock.question.createMany.mock.calls[0]![0].data[0].marks).toBe(1);
  });

  it('accepts exactly two options', async () => {
    const result = await QuestionImportService.importForQuiz('q1', csv('Q,yes,no,,,2,1'));

    expect(result.imported).toBe(1);
    expect(prismaMock.question.createMany.mock.calls[0]![0].data[0].options).toEqual(['yes', 'no']);
  });

  it('inserts the whole file in ONE statement', async () => {
    await QuestionImportService.importForQuiz(
      'q1',
      csv('Q1,a,b,,,1,1', 'Q2,a,b,,,2,1', 'Q3,a,b,,,1,1')
    );

    // A per-row loop is the N+1 a 200-question import would otherwise ship.
    expect(prismaMock.question.createMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.question.createMany.mock.calls[0]![0].data).toHaveLength(3);
    expect(prismaMock.question.create).not.toHaveBeenCalled();
  });

  it('continues positions after questions already on the quiz', async () => {
    prismaMock.question.findFirst.mockResolvedValue({ position: 4 });

    await QuestionImportService.importForQuiz('q1', csv('Q1,a,b,,,1,1', 'Q2,a,b,,,1,1'));

    // An import adds to a hand-built paper rather than colliding with it.
    const data = prismaMock.question.createMany.mock.calls[0]![0].data;
    expect(data.map((d: { position: number }) => d.position)).toEqual([5, 6]);
  });
});

describe('invalid rows are rejected individually', () => {
  it.each([
    ['an empty question', ',a,b,,,1,1', /question text is empty/],
    ['only one option', 'Q,a,,,,1,1', /at least two options/i],
    ['duplicate options', 'Q,same,same,,,1,1', /distinct/],
    ['a missing correctOption', 'Q,a,b,,,,1', /correctOption is missing/],
    ['a non-numeric correctOption', 'Q,a,b,,,two,1', /must be a whole number/],
    ['an out-of-range correctOption', 'Q,a,b,,,4,1', /but this row has 2 option/],
    ['a zero correctOption', 'Q,a,b,,,0,1', /but this row has 2 option/],
    ['zero marks', 'Q,a,b,,,1,0', /marks must be a whole number/],
    ['negative marks', 'Q,a,b,,,1,-3', /marks must be a whole number/],
    ['a gap in the options', 'Q,a,b,,d,1,1', /left to right/],
  ])('rejects %s', async (_label, row, pattern) => {
    const result = await QuestionImportService.importForQuiz('q1', csv(row));

    expect(result.imported).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.rejected[0].reason).toMatch(pattern);
  });

  it('reports the SOURCE line number so the row can be found', async () => {
    const result = await QuestionImportService.importForQuiz(
      'q1',
      csv('Q1,a,b,,,1,1', 'Q2,a,b,,,9,1')
    );

    // Line 1 is the header, so the second data row is line 3.
    expect(result.rejected[0].row).toBe(3);
  });
});

describe('partial success', () => {
  it('imports the good rows and reports the bad ones', async () => {
    const result = await QuestionImportService.importForQuiz(
      'q1',
      csv('Good 1,a,b,,,1,1', ',a,b,,,1,1', 'Good 2,a,b,,,2,1', 'Bad,a,,,,1,1')
    );

    // An admin who pasted forty questions and got one wrong should get
    // thirty-nine in, not a rejection of the lot.
    expect(result).toMatchObject({ totalRows: 4, imported: 2, failed: 2 });
    expect(prismaMock.question.createMany.mock.calls[0]![0].data).toHaveLength(2);
  });

  it('does not touch the database when every row fails', async () => {
    const result = await QuestionImportService.importForQuiz('q1', csv(',a,b,,,1,1'));

    expect(result.imported).toBe(0);
    expect(prismaMock.question.createMany).not.toHaveBeenCalled();
  });
});

// --- Format tolerance --------------------------------------------------------

describe('real files, not idealised ones', () => {
  it('accepts quoted cells containing commas', async () => {
    await QuestionImportService.importForQuiz(
      'q1',
      csv('"Which, if any, is a hook?",useState,setState,,,1,1')
    );

    expect(prismaMock.question.createMany.mock.calls[0]![0].data[0].question).toBe(
      'Which, if any, is a hook?'
    );
  });

  it('matches headers case- and space-insensitively', async () => {
    const result = await QuestionImportService.importForQuiz(
      'q1',
      'Question,Option 1,Option 2,Option 3,Option 4,Correct Option,Marks\nQ,a,b,,,1,1'
    );

    // A file exported from a spreadsheet should not fail on capitalisation.
    expect(result.imported).toBe(1);
  });

  it('ignores extra columns', async () => {
    const result = await QuestionImportService.importForQuiz(
      'q1',
      `${HEADER},notes\nQ,a,b,,,1,1,some note`
    );

    expect(result.imported).toBe(1);
  });
});

describe('template', () => {
  it('carries the documented headers and a worked example', () => {
    const template = QuestionImportService.template();
    const [header, firstRow] = template.split('\n');

    // `toCsv` writes a UTF-8 BOM and CRLF line endings so Excel opens the file
    // in the right encoding — both stripped here, and both demonstrably
    // harmless to the parser by the round-trip test below.
    expect(header.replace(/^\uFEFF/, '').trim()).toBe(HEADER);
    // A populated example is what makes "correctOption is an index" obvious.
    expect(firstRow).toBeTruthy();
  });

  it('round-trips through its own importer', async () => {
    const result = await QuestionImportService.importForQuiz(
      'q1',
      QuestionImportService.template()
    );

    // The strongest check on the template: whatever it demonstrates must be
    // something the parser actually accepts.
    expect(result.failed).toBe(0);
    expect(result.imported).toBe(2);
  });
});
