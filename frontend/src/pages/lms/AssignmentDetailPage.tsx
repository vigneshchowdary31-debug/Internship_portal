import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  ArrowLeft,
  CalendarClock,
  Award,
  Loader2,
  ClipboardList,
  FileQuestion,
} from 'lucide-react';
import { SubmissionSection } from '@/components/lms/SubmissionSection';
import { assignmentsApi } from '@/services/assignments';
import { cn } from '@/lib/utils';

/**
 * One assignment, with everything the student needs to act on it.
 *
 * Visibility is entirely the server's: `GET /assignments/:id` resolves through
 * the shared resolver, so a draft, one in a hidden module, and another batch's
 * work all come back 404. Nothing here re-checks it — a 404 simply renders as
 * "not available", carrying no information about which of the three it was.
 */
export const AssignmentDetailPage = () => {
  const { id } = useParams<{ id: string }>();

  const {
    data: assignment,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['assignment', id],
    queryFn: () => assignmentsApi.get(id!),
    enabled: !!id,
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-20 text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading assignment…
      </div>
    );
  }

  if (isError || !assignment) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center py-16 text-center">
          <FileQuestion className="mb-3 h-8 w-8 text-gray-300" />
          <p className="font-medium text-gray-700">This assignment is not available</p>
          <p className="mt-1 max-w-sm text-sm text-gray-500">
            It may have been withdrawn, or it is not part of your course.
          </p>
          <Button variant="outline" className="mt-4" asChild>
            <Link to="/student/course">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to my course
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const deadline = new Date(assignment.deadline);
  const pastDeadline = deadline.getTime() < Date.now();

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <Link to="/student/course">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to my course
        </Link>
      </Button>

      <Card className="border-t-4 border-t-amber-500">
        <CardHeader className="pb-3">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md bg-amber-50">
              <ClipboardList className="h-5 w-5 text-amber-600" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <CardTitle className="text-xl">{assignment.title}</CardTitle>
              <p className="mt-1 text-sm text-gray-500">
                {assignment.module?.name ? `${assignment.module.name} · ` : ''}Assignment
              </p>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              className={cn(
                'gap-1',
                pastDeadline
                  ? 'border-red-200 bg-red-50 text-red-700'
                  : 'border-gray-200 bg-gray-50 text-gray-700'
              )}
            >
              <CalendarClock className="h-3 w-3" />
              {pastDeadline ? 'Closed' : 'Due'} {deadline.toLocaleString()}
            </Badge>
            <Badge variant="outline" className="gap-1">
              <Award className="h-3 w-3" />
              {assignment.maxMarks} marks
            </Badge>
            {!assignment.allowResubmission && (
              <Badge variant="outline" className="text-gray-500">
                One attempt only
              </Badge>
            )}
          </div>
        </CardHeader>

        <CardContent>
          {/*
            Rendered as TEXT, not HTML.

            The column holds admin-authored rich text, and the authoring field
            is currently a plain textarea — so `whitespace-pre-wrap` renders
            exactly what was written, with paragraphs intact. Switching to
            dangerouslySetInnerHTML without a sanitiser would turn an
            admin-authored field into stored XSS against every student on the
            course. When a rich-text editor is added, add DOMPurify with it.
          */}
          <div className="whitespace-pre-wrap text-sm leading-relaxed text-gray-700">
            {assignment.description}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Your submission</CardTitle>
        </CardHeader>
        <CardContent>
          <SubmissionSection assignment={assignment} />
        </CardContent>
      </Card>
    </div>
  );
};
