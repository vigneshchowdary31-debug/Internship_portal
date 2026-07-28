import { MoreHorizontal, Edit, Trash2, Users, GraduationCap } from 'lucide-react';
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
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { TechStack } from '../tech-stacks/TechStackTable';

export interface Batch {
  id: string;
  name: string;
  techStackId: string;
  techStack: TechStack;
  studentBatches: { student: { id: string; name: string; email: string } }[];
  instructorBatches: { instructor: { id: string; name: string } }[];
}

interface BatchTableProps {
  batches: Batch[];
  onEdit: (batch: Batch) => void;
  onDelete: (batch: Batch) => void;
  onAssignStudents: (batch: Batch) => void;
  onAssignInstructors: (batch: Batch) => void;
}

export function BatchTable({
  batches,
  onEdit,
  onDelete,
  onAssignStudents,
  onAssignInstructors,
}: BatchTableProps) {
  if (!batches || batches.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-center border rounded-lg bg-gray-50/50">
        <p className="text-sm text-gray-500">No batches found.</p>
      </div>
    );
  }

  return (
    <div className="rounded-md border bg-white">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Batch Name</TableHead>
            <TableHead>Tech Stack</TableHead>
            <TableHead>Students</TableHead>
            <TableHead>Instructors</TableHead>
            <TableHead className="w-[100px] text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {batches.map((batch) => (
            <TableRow key={batch.id}>
              <TableCell className="font-medium">{batch.name}</TableCell>
              <TableCell>
                <Badge variant="outline">{batch.techStack.name}</Badge>
              </TableCell>
              <TableCell>
                <div className="flex items-center text-gray-600">
                  <Users className="w-4 h-4 mr-2" />
                  {batch.studentBatches?.length || 0}
                </div>
              </TableCell>
              <TableCell>
                <div className="flex items-center text-gray-600">
                  <GraduationCap className="w-4 h-4 mr-2" />
                  {batch.instructorBatches?.length || 0}
                </div>
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
                    <DropdownMenuLabel>Manage</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => onAssignStudents(batch)}>
                      <Users className="mr-2 h-4 w-4" />
                      Assign Students
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onAssignInstructors(batch)}>
                      <GraduationCap className="mr-2 h-4 w-4" />
                      Assign Instructors
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => onEdit(batch)}>
                      <Edit className="mr-2 h-4 w-4" />
                      Edit Details
                    </DropdownMenuItem>
                    <DropdownMenuItem 
                      onClick={() => onDelete(batch)}
                      className="text-red-600"
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete Batch
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
