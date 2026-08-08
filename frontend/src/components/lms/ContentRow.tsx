import { useMutation } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useToast, errorMessage } from '@/components/ui/toast';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  FileText,
  Presentation,
  FileType,
  FolderGit2,
  Video,
  Link as LinkIcon,
  Film,
  MoreHorizontal,
  Pencil,
  Trash2,
  Eye,
  Archive,
  Send,
  Clock,
  Layers,
  BookOpen,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { lmsApi, CONTENT_TYPE_LABELS, type ContentType, type LmsContent } from '@/services/lms';
import { opensInBrowser, viewerPath } from '@/lib/contentUrl';
import { cn } from '@/lib/utils';

const TYPE_ICONS: Record<ContentType, typeof FileText> = {
  PDF: FileText,
  PPT: Presentation,
  DOCX: FileType,
  VIDEO: Film,
  GITHUB_REPO: FolderGit2,
  RECORDING: Video,
  LINK: LinkIcon,
  REFERENCE: BookOpen,
};

const STATUS_STYLES: Record<string, string> = {
  DRAFT: 'border-gray-200 bg-gray-50 text-gray-600',
  PUBLISHED: 'border-green-200 bg-green-50 text-green-700',
  ARCHIVED: 'border-amber-200 bg-amber-50 text-amber-700',
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * One content item in the admin/instructor curriculum view.
 *
 * Shows the three facts that determine whether a student can actually see it:
 * publication status, scheduled release, and batch scope.
 */
export function ContentRow({
  content,
  canEdit,
  onEdit,
  onChanged,
}: {
  content: LmsContent;
  canEdit: boolean;
  onEdit: (content: LmsContent) => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const Icon = TYPE_ICONS[content.type];

  const setStatus = useMutation({
    mutationFn: (status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED') =>
      lmsApi.setContentStatus(content.id, status),
    onSuccess: (_d, status) => {
      onChanged();
      toast.success(
        status === 'PUBLISHED' ? 'Published' : status === 'ARCHIVED' ? 'Archived' : 'Moved to draft'
      );
    },
    onError: (err) => toast.error('Could not change status', errorMessage(err)),
  });

  const remove = useMutation({
    mutationFn: () => lmsApi.deleteContent(content.id),
    onSuccess: () => {
      onChanged();
      toast.success('Content deleted');
    },
    onError: (err) => toast.error('Could not delete', errorMessage(err)),
  });

  const scheduled = content.releaseAt && new Date(content.releaseAt) > new Date();
  const href = content.asset?.url ?? content.externalUrl ?? undefined;

  return (
    <div className="flex items-start gap-3 rounded-md border bg-white p-3">
      <span className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-gray-100">
        <Icon className="h-4 w-4 text-gray-600" aria-hidden="true" />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm font-medium text-gray-900">{content.title}</span>
          <Badge variant="outline" className={cn('text-[10px]', STATUS_STYLES[content.status])}>
            {content.status.charAt(0) + content.status.slice(1).toLowerCase()}
          </Badge>
          {content.scope === 'BATCH' && (
            <Badge variant="outline" className="gap-1 border-indigo-200 bg-indigo-50 text-[10px] text-indigo-700">
              <Layers className="h-2.5 w-2.5" />
              {content.overridesId ? 'Overrides' : 'Batch only'}
              {content.batch ? ` · ${content.batch.name}` : ''}
            </Badge>
          )}
          {content.overriddenBy && (
            <Badge variant="outline" className="border-amber-200 bg-amber-50 text-[10px] text-amber-700">
              Overridden for one batch
            </Badge>
          )}
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-gray-500">
          <span>{CONTENT_TYPE_LABELS[content.type]}</span>
          {content.asset && <span>{formatSize(content.asset.sizeBytes)}</span>}
          {scheduled && (
            <span className="flex items-center gap-1 font-medium text-amber-700">
              <Clock className="h-3 w-3" />
              Releases {new Date(content.releaseAt!).toLocaleString()}
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-shrink-0 items-center gap-1">
        {href &&
          // The same in-app viewer students get, so an author previews exactly
          // what the class will see. Office documents cannot be rendered by any
          // browser, so those keep the download link.
          (opensInBrowser(content.type) ? (
            <Button variant="ghost" size="sm" asChild className="h-8">
              <Link
                to={viewerPath({
                  url: href,
                  type: content.type,
                  title: content.title,
                  moduleId: content.moduleId,
                })}
              >
                <Eye className="mr-1.5 h-3.5 w-3.5" />
                Open
              </Link>
            </Button>
          ) : (
            <Button variant="ghost" size="sm" asChild className="h-8">
              <a href={href} target="_blank" rel="noopener noreferrer">
                <Eye className="mr-1.5 h-3.5 w-3.5" />
                Open
              </a>
            </Button>
          ))}

        {canEdit && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-8 w-8 p-0">
                <span className="sr-only">Actions for {content.title}</span>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onEdit(content)}>
                <Pencil className="mr-2 h-4 w-4" />
                Edit
              </DropdownMenuItem>

              {content.status !== 'PUBLISHED' && (
                <DropdownMenuItem onClick={() => setStatus.mutate('PUBLISHED')}>
                  <Send className="mr-2 h-4 w-4 text-green-600" />
                  Publish
                </DropdownMenuItem>
              )}
              {content.status === 'PUBLISHED' && (
                <DropdownMenuItem onClick={() => setStatus.mutate('DRAFT')}>
                  <Pencil className="mr-2 h-4 w-4" />
                  Move to draft
                </DropdownMenuItem>
              )}
              {content.status !== 'ARCHIVED' && (
                <DropdownMenuItem onClick={() => setStatus.mutate('ARCHIVED')}>
                  <Archive className="mr-2 h-4 w-4 text-amber-600" />
                  Archive
                </DropdownMenuItem>
              )}

              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => remove.mutate()}
                className="text-red-600"
                disabled={remove.isPending}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
}
