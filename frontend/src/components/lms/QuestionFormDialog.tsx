import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Plus, X, CheckCircle2, Circle } from 'lucide-react';
import type { QuizQuestion, QuestionPayload } from '@/services/quizzes';
import { cn } from '@/lib/utils';

/**
 * MCQ builder.
 *
 * The correct answer is chosen by CLICKING an option rather than typed into a
 * separate field. The server requires `correctAnswer` to be one of `options`
 * and rejects anything else — a free-text field would let a typo produce a
 * question nobody can ever score, which stays invisible until the first student
 * submits and every answer comes back wrong.
 *
 * The answer is submitted as the option's VALUE, matching how the server marks:
 * `answers[questionId] === question.correctAnswer`. Editing an option's text
 * therefore moves the answer with it, which is why the selection is held by
 * index here and resolved to text on submit.
 */

const MIN_OPTIONS = 2;
const MAX_OPTIONS = 10;

export function QuestionFormDialog({
  open,
  onOpenChange,
  onSubmit,
  initialData,
  isLoading,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: QuestionPayload) => void;
  initialData?: QuizQuestion | null;
  isLoading: boolean;
}) {
  const isEditing = !!initialData;

  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState<string[]>(['', '']);
  const [correctIndex, setCorrectIndex] = useState<number | null>(null);
  const [marks, setMarks] = useState('1');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;

    if (initialData) {
      setQuestion(initialData.question);
      setOptions(initialData.options);
      setCorrectIndex(initialData.options.indexOf(initialData.correctAnswer ?? ''));
      setMarks(String(initialData.marks));
    } else {
      setQuestion('');
      setOptions(['', '']);
      setCorrectIndex(null);
      setMarks('1');
    }
    setError(null);
  }, [open, initialData]);

  const setOption = (index: number, value: string) =>
    setOptions((current) => current.map((o, i) => (i === index ? value : o)));

  const addOption = () =>
    setOptions((current) => (current.length < MAX_OPTIONS ? [...current, ''] : current));

  const removeOption = (index: number) => {
    setOptions((current) => current.filter((_, i) => i !== index));
    // The correct answer follows its option: removing one above it shifts the
    // index down, and removing it outright clears the selection rather than
    // silently marking a different option correct.
    setCorrectIndex((current) => {
      if (current === null) return null;
      if (current === index) return null;
      return current > index ? current - 1 : current;
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!question.trim()) return setError('Enter the question.');

    const cleaned = options.map((o) => o.trim());
    if (cleaned.some((o) => !o)) return setError('Every option needs text.');
    if (cleaned.length < MIN_OPTIONS) return setError('A question needs at least two options.');
    if (new Set(cleaned).size !== cleaned.length) return setError('Options must be distinct.');
    if (correctIndex === null || !cleaned[correctIndex]) {
      return setError('Mark one option as the correct answer.');
    }

    const value = Number(marks);
    if (!Number.isInteger(value) || value < 1 || value > 100) {
      return setError('Marks must be a whole number between 1 and 100.');
    }

    onSubmit({
      question: question.trim(),
      options: cleaned,
      correctAnswer: cleaned[correctIndex],
      marks: value,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit question' : 'New question'}</DialogTitle>
          <DialogDescription>
            Click an option to mark it correct. Students never receive the answer key.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="q-text">Question</Label>
            <Textarea
              id="q-text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="What does the useEffect hook do?"
              rows={2}
              maxLength={2000}
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Options</Label>
              <span className="text-xs text-gray-500">
                {correctIndex === null ? 'Click one to mark it correct' : 'Correct answer marked'}
              </span>
            </div>

            <div className="space-y-2">
              {options.map((option, index) => {
                const isCorrect = correctIndex === index;
                return (
                  <div
                    key={index}
                    className={cn(
                      'flex items-center gap-2 rounded-md border p-1.5 transition-colors',
                      isCorrect ? 'border-green-300 bg-green-50' : 'bg-white'
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => setCorrectIndex(index)}
                      className="flex-shrink-0 rounded p-1"
                      aria-label={`Mark option ${index + 1} as correct`}
                      aria-pressed={isCorrect}
                    >
                      {isCorrect ? (
                        <CheckCircle2 className="h-4 w-4 text-green-600" />
                      ) : (
                        <Circle className="h-4 w-4 text-gray-300" />
                      )}
                    </button>

                    <Input
                      value={option}
                      onChange={(e) => setOption(index, e.target.value)}
                      placeholder={`Option ${index + 1}`}
                      maxLength={500}
                      className="h-8 border-0 shadow-none focus-visible:ring-0"
                    />

                    {options.length > MIN_OPTIONS && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 flex-shrink-0 p-0 text-gray-400"
                        onClick={() => removeOption(index)}
                        aria-label={`Remove option ${index + 1}`}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>

            {options.length < MAX_OPTIONS && (
              <Button type="button" variant="outline" size="sm" onClick={addOption}>
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Add option
              </Button>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="q-marks">Marks</Label>
            <Input
              id="q-marks"
              type="number"
              min={1}
              max={100}
              value={marks}
              onChange={(e) => setMarks(e.target.value)}
              className="w-28"
            />
          </div>

          {error && (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isEditing ? 'Save question' : 'Add question'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
