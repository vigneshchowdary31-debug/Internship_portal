
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import {
  LayoutDashboard,
  Users,
  UserCheck,
  Layers,
  ListChecks,
  BookOpen,
  Video,
  CalendarDays,
  Settings,
  LogOut,
  ClipboardCheck,
  BarChart,
  GraduationCap
} from 'lucide-react';

const adminNavItems = [
  { title: "Dashboard", url: "/admin", icon: LayoutDashboard },
  { title: "Students", url: "/admin/students", icon: Users },
  { title: "Instructors", url: "/admin/instructors", icon: UserCheck },
  { title: "Tech Stacks", url: "/admin/tech-stacks", icon: Layers },
  { title: "Batches", url: "/admin/batches", icon: BookOpen },
  { title: "Curriculum", url: "/admin/curriculum", icon: GraduationCap },
  { title: "Quizzes", url: "/admin/quizzes", icon: ListChecks },
  { title: "Sessions", url: "/admin/sessions", icon: Video },
  { title: "Attendance", url: "/admin/attendance", icon: ClipboardCheck },
  { title: "Progress", url: "/admin/progress", icon: BarChart },
  { title: "Calendar", url: "/admin/calendar", icon: CalendarDays },
  { title: "Settings", url: "/profile", icon: Settings },
];

const instructorNavItems = [
  { title: "Dashboard", url: "/instructor", icon: LayoutDashboard },
  { title: "Curriculum", url: "/instructor/curriculum", icon: GraduationCap },
  { title: "Attendance", url: "/instructor/attendance", icon: ClipboardCheck },
  { title: "Progress", url: "/instructor/progress", icon: BarChart },
  { title: "Profile", url: "/profile", icon: Settings },
];

const studentNavItems = [
  { title: "Dashboard", url: "/student", icon: LayoutDashboard },
  { title: "My Course", url: "/student/course", icon: GraduationCap },
  { title: "Profile", url: "/profile", icon: Settings },
];

export function AppSidebar() {
  const { user, logout } = useAuth();
  const location = useLocation();

  let navItems: { title: string, url: string, icon: any }[] = [];
  if (user?.role === 'ADMIN') navItems = adminNavItems;
  else if (user?.role === 'INSTRUCTOR') navItems = instructorNavItems;
  else if (user?.role === 'STUDENT') navItems = studentNavItems;

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="p-4 flex flex-row items-center justify-start gap-2">
        <div className="bg-primary text-primary-foreground p-1 rounded-md">
          <BookOpen className="w-5 h-5" />
        </div>
        <span className="font-bold text-lg whitespace-nowrap overflow-hidden">
          Training Portal
        </span>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Menu</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild isActive={location.pathname === item.url} tooltip={item.title}>
                    <Link to={item.url}>
                      <item.icon />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={logout} className="text-red-500 hover:text-red-600">
              <LogOut />
              <span>Logout</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
