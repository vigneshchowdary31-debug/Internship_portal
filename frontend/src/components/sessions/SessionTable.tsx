import { MoreHorizontal, Edit, XCircle, ExternalLink, Calendar, Clock } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

export interface Session {
  id: string;
  title: string;
  description: string | null;
  startTime: string;
  endTime: string;
  status: 'SCHEDULED' | 'COMPLETED' | 'CANCELLED';
  googleMeetLink: string | null;
  batchId: string;
  instructorId: string;
  batch: { name: string };
  instructor: { name: string };
}

interface SessionTableProps {
  sessions: Session[];
  onView: (session: Session) => void;
  onEdit: (session: Session) => void;
  onCancel: (session: Session) => void;
}

export function SessionTable({
  sessions,
  onView,
  onEdit,
  onCancel,
}: SessionTableProps) {
  if (!sessions || sessions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-center border rounded-lg bg-gray-50/50">
        <p className="text-sm text-gray-500">No sessions scheduled.</p>
      </div>
    );
  }

  return (
    <div className="rounded-md border bg-white">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Title</TableHead>
            <TableHead>Target</TableHead>
            <TableHead>Timing</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Meeting</TableHead>
            <TableHead className="w-[100px] text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sessions.map((session) => {
            const startDate = new Date(session.startTime);
            const endDate = new Date(session.endTime);
            const duration = Math.round((endDate.getTime() - startDate.getTime()) / 60000);

            return (
              <TableRow key={session.id}>
                <TableCell className="font-medium">
                  {session.title}
                  {session.description && (
                    <div className="text-xs text-gray-500 mt-1 line-clamp-1">{session.description}</div>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex flex-col">
                    <span className="text-sm font-semibold">{session.batch.name}</span>
                    <span className="text-xs text-gray-500">by {session.instructor.name}</span>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex flex-col text-sm text-gray-700">
                    <div className="flex items-center">
                      <Calendar className="w-3 h-3 mr-1" />
                      {startDate.toLocaleDateString()}
                    </div>
                    <div className="flex items-center mt-1 text-xs text-gray-500">
                      <Clock className="w-3 h-3 mr-1" />
                      {startDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ({duration}m)
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  {session.status === 'SCHEDULED' && <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100">Scheduled</Badge>}
                  {session.status === 'COMPLETED' && <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Completed</Badge>}
                  {session.status === 'CANCELLED' && <Badge className="bg-red-100 text-red-800 hover:bg-red-100">Cancelled</Badge>}
                </TableCell>
                <TableCell>
                  {session.googleMeetLink ? (
                    <a 
                      href={session.googleMeetLink} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-indigo-600 hover:text-indigo-800 flex items-center text-sm"
                    >
                      Join Meet <ExternalLink className="w-3 h-3 ml-1" />
                    </a>
                  ) : (
                    <span className="text-xs text-gray-400">N/A</span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" className="h-8 w-8 p-0">
                        <span className="sr-only">Open menu</span>
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuSeparator />

                      <DropdownMenuItem onClick={() => onView(session)}>
                        <ExternalLink className="mr-2 h-4 w-4 text-blue-500" />
                        View Details
                      </DropdownMenuItem>
                      
                      <DropdownMenuItem onClick={() => onEdit(session)} disabled={session.status === 'CANCELLED'}>
                        <Edit className="mr-2 h-4 w-4" />
                        Edit Details
                      </DropdownMenuItem>
                      
                      <DropdownMenuItem 
                        onClick={() => onCancel(session)} 
                        disabled={session.status === 'CANCELLED' || session.status === 'COMPLETED'}
                      >
                        <XCircle className="mr-2 h-4 w-4 text-orange-500" />
                        Cancel Session
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
