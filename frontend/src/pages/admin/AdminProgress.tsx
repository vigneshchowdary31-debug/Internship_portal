import { useQuery } from '@tanstack/react-query';
import api from '../../services/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { BarChart, TrendingUp, TrendingDown, Users } from 'lucide-react';

export const AdminProgress = () => {
  const { data: progressData, isLoading } = useQuery({
    queryKey: ['admin-progress'],
    queryFn: () => api.get('/progress/overview').then(res => res.data.data)
  });

  const records = progressData || [];
  
  // Calculate stats
  const total = records.length;
  const avgProgress = total > 0 ? Math.round(records.reduce((acc: any, curr: any) => acc + curr.progress, 0) / total) : 0;
  const below50 = records.filter((r: any) => r.progress < 50).length;
  const advanced = records.filter((r: any) => r.level === 'ADVANCED').length;

  if (isLoading) return <div className="p-8">Loading progress data...</div>;

  return (
    <div className="space-y-6">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Student Progress Overview</h2>
        <p className="text-gray-500">Monitor academic performance across all tech stacks.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Average Progress</CardTitle>
            <BarChart className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{avgProgress}%</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">At Risk (&lt;50%)</CardTitle>
            <TrendingDown className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{below50}</div>
            <p className="text-xs text-muted-foreground">Students require attention</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Advanced Students</CardTitle>
            <TrendingUp className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{advanced}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Tracked</CardTitle>
            <Users className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">{total}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Detailed Progress Reports</CardTitle>
          <CardDescription>Comprehensive view of individual student performance</CardDescription>
        </CardHeader>
        <CardContent>
          {records.length === 0 ? (
            <div className="text-center py-8 text-gray-500">No progress records found.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-gray-50 text-gray-600 font-medium border-b">
                  <tr>
                    <th className="px-4 py-3">Student Name</th>
                    <th className="px-4 py-3">Tech Stack</th>
                    <th className="px-4 py-3">Progress</th>
                    <th className="px-4 py-3">Level</th>
                    <th className="px-4 py-3">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {records.map((r: any) => (
                    <tr key={r.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-900">{r.student.name}</td>
                      <td className="px-4 py-3">{r.techStack.name}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-full bg-gray-200 rounded-full h-2.5">
                            <div className={`h-2.5 rounded-full ${r.progress < 50 ? 'bg-red-500' : r.progress < 80 ? 'bg-yellow-500' : 'bg-green-500'}`} style={{ width: `${r.progress}%` }}></div>
                          </div>
                          <span className="text-xs text-gray-500">{r.progress}%</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 rounded-full text-[10px] font-bold ${
                          r.level === 'ADVANCED' ? 'bg-purple-100 text-purple-800' :
                          r.level === 'INTERMEDIATE' ? 'bg-blue-100 text-blue-800' :
                          'bg-gray-100 text-gray-800'
                        }`}>
                          {r.level}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs max-w-xs truncate" title={r.notes}>{r.notes || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
