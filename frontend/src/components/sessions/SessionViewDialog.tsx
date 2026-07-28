import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ExternalLink, Calendar, Clock, User, Users, Info } from 'lucide-react';
import type { Session } from './SessionTable';

interface SessionViewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: Session | null;
}

export function SessionViewDialog({ open, onOpenChange, session }: SessionViewDialogProps) {
  if (!session) return null;

  const startDate = new Date(session.startTime);
  const endDate = new Date(session.endTime);
  const duration = Math.round((endDate.getTime() - startDate.getTime()) / 60000);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <div className="flex justify-between items-start pr-6">
            <DialogTitle className="text-xl font-bold">{session.title}</DialogTitle>
            {session.status === 'SCHEDULED' && <Badge className="bg-blue-100 text-blue-800">Scheduled</Badge>}
            {session.status === 'COMPLETED' && <Badge className="bg-green-100 text-green-800">Completed</Badge>}
            {session.status === 'CANCELLED' && <Badge className="bg-red-100 text-red-800">Cancelled</Badge>}
          </div>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {session.description && (
            <div className="text-sm text-gray-700 bg-gray-50 p-3 rounded-md border">
              {session.description}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4 text-sm">
            <div className="space-y-3">
              <div className="flex items-center text-gray-600">
                <Users className="w-4 h-4 mr-2" />
                <span className="font-medium mr-2">Batch:</span>
                <span className="text-gray-900">{session.batch.name}</span>
              </div>
              <div className="flex items-center text-gray-600">
                <User className="w-4 h-4 mr-2" />
                <span className="font-medium mr-2">Instructor:</span>
                <span className="text-gray-900">{session.instructor.name}</span>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center text-gray-600">
                <Calendar className="w-4 h-4 mr-2" />
                <span className="font-medium mr-2">Date:</span>
                <span className="text-gray-900">{startDate.toLocaleDateString()}</span>
              </div>
              <div className="flex items-center text-gray-600">
                <Clock className="w-4 h-4 mr-2" />
                <span className="font-medium mr-2">Time:</span>
                <span className="text-gray-900">
                  {startDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} 
                  <span className="text-gray-400 mx-1">({duration}m)</span>
                </span>
              </div>
            </div>
          </div>

          <div className="border-t pt-4">
            <div className="flex flex-col gap-2">
              <div className="text-sm font-medium text-gray-900 flex items-center">
                <Info className="w-4 h-4 mr-2" /> Meeting Details
              </div>
              {session.googleMeetLink ? (
                <a 
                  href={session.googleMeetLink} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-indigo-600 hover:text-indigo-800 flex items-center text-sm font-medium p-3 bg-indigo-50 rounded-md border border-indigo-100"
                >
                  <ExternalLink className="w-4 h-4 mr-2" />
                  {session.googleMeetLink}
                </a>
              ) : (
                <div className="text-sm text-gray-500 italic bg-gray-50 p-3 rounded-md border">
                  No meeting link generated for this session.
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex justify-end pt-4 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
