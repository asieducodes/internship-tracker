import { useEffect, useMemo, useState, useCallback } from 'react';
import { supabase } from './supabaseClient';
import {
  Plus,
  X,
  ChevronLeft,
  ChevronRight,
  Clock,
  Clock3,
  AlertTriangle,
  Send,
  Users,
  Gauge,
  ListChecks,
  Pencil,
  Trash2,
  Search,
  Download,
  LayoutGrid,
  FileText,
  Sun,
  Moon,
  CalendarCheck,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const STATUS_ORDER = ['To-Do', 'In Progress', 'Review', 'Done'];

const COLUMN_META = {
  'To-Do': { accent: 'bg-slate-500' },
  'In Progress': { accent: 'bg-sky-500' },
  Review: { accent: 'bg-violet-500' },
  Done: { accent: 'bg-emerald-500' },
};

const PRIORITY_META = {
  High: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/30',
  Medium: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/30',
  Low: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30',
};

const ATTENDANCE_STATUS_META = {
  Present: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30',
  Late: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/30',
  Absent: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/30',
};

const ATTENDANCE_STATUSES = ['Present', 'Late', 'Absent'];

const PRIORITY_OPTIONS = ['All', 'High', 'Medium', 'Low'];

const EMPTY_TASK_FORM = {
  task_name: '',
  assignee: '',
  priority: 'Medium',
  due_date: '',
  hours_logged: '',
};

const EMPTY_REPORT_FORM = {
  intern_name: '',
  accomplishments: '',
  blockers: '',
  next_steps: '',
};

const EMPTY_CHECKIN_FORM = {
  intern_name: '',
  status: 'Present',
};

const THEME_KEY = 'sarbahtek-tracker-theme';

const INPUT_CLASS =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 outline-none transition focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder-slate-600';

function formatDate(value) {
  if (!value) return 'No due date';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function todayIso() {
  const d = new Date();
  const offset = d.getTimezoneOffset();
  const local = new Date(d.getTime() - offset * 60 * 1000);
  return local.toISOString().slice(0, 10);
}

function initials(name) {
  if (!name) return '?';
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

function isOverdue(task) {
  if (!task.due_date || task.status === 'Done') return false;
  const due = new Date(task.due_date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return due < today;
}

function downloadCsv(filename, rows, columns) {
  const escape = (value) => {
    const str = value === null || value === undefined ? '' : String(value);
    if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
    return str;
  };
  const header = columns.map((c) => escape(c.label)).join(',');
  const body = rows
    .map((row) => columns.map((c) => escape(row[c.key])).join(','))
    .join('\n');
  const csv = `${header}\n${body}`;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function useTheme() {
  const [theme, setTheme] = useState(() => {
    if (typeof window === 'undefined') return 'dark';
    const stored = window.localStorage.getItem(THEME_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
    return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') root.classList.add('dark');
    else root.classList.remove('dark');
    window.localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));

  return { theme, toggleTheme };
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export default function App() {
  const { theme, toggleTheme } = useTheme();
  const [view, setView] = useState('board'); // 'board' | 'reports' | 'attendance'

  const [tasks, setTasks] = useState([]);
  const [reports, setReports] = useState([]);
  const [attendance, setAttendance] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [editingTask, setEditingTask] = useState(null); // null = creating

  const [taskForm, setTaskForm] = useState(EMPTY_TASK_FORM);
  const [reportForm, setReportForm] = useState(EMPTY_REPORT_FORM);
  const [checkinForm, setCheckinForm] = useState(EMPTY_CHECKIN_FORM);
  const [savingTask, setSavingTask] = useState(false);
  const [savingReport, setSavingReport] = useState(false);
  const [savingCheckin, setSavingCheckin] = useState(false);

  const [searchText, setSearchText] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('All');
  const [reportSearch, setReportSearch] = useState('');

  const fetchTasks = useCallback(async () => {
    const { data, error: fetchError } = await supabase
      .from('tasks')
      .select('*')
      .order('created_at', { ascending: false });
    if (fetchError) throw fetchError;
    return data ?? [];
  }, []);

  const fetchReports = useCallback(async () => {
    const { data, error: fetchError } = await supabase
      .from('reports')
      .select('*')
      .order('created_at', { ascending: false });
    if (fetchError) throw fetchError;
    return data ?? [];
  }, []);

  const fetchAttendance = useCallback(async () => {
    const { data, error: fetchError } = await supabase
      .from('attendance')
      .select('*')
      .order('date', { ascending: false });
    if (fetchError) throw fetchError;
    return data ?? [];
  }, []);

  const loadAll = useCallback(async () => {
    try {
      setError(null);
      const [taskRows, reportRows, attendanceRows] = await Promise.all([
        fetchTasks(),
        fetchReports(),
        fetchAttendance(),
      ]);
      setTasks(taskRows);
      setReports(reportRows);
      setAttendance(attendanceRows);
    } catch (err) {
      setError(err.message || 'Something went wrong while loading data.');
    } finally {
      setLoading(false);
    }
  }, [fetchTasks, fetchReports, fetchAttendance]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // -- Derived metrics -------------------------------------------------------

  const metrics = useMemo(() => {
    const total = tasks.length;
    const done = tasks.filter((t) => t.status === 'Done').length;
    const completion = total === 0 ? 0 : Math.round((done / total) * 100);
    const activeBlockers = reports.filter((r) => r.blockers && r.blockers.trim().length > 0).length;
    const totalHours = tasks.reduce((sum, t) => sum + (Number(t.hours_logged) || 0), 0);
    return { total, completion, activeBlockers, totalHours };
  }, [tasks, reports]);

  const filteredTasks = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    return tasks.filter((task) => {
      const matchesQuery =
        !query ||
        task.task_name.toLowerCase().includes(query) ||
        task.assignee.toLowerCase().includes(query);
      const matchesPriority = priorityFilter === 'All' || task.priority === priorityFilter;
      return matchesQuery && matchesPriority;
    });
  }, [tasks, searchText, priorityFilter]);

  const tasksByStatus = useMemo(() => {
    const grouped = Object.fromEntries(STATUS_ORDER.map((s) => [s, []]));
    for (const task of filteredTasks) {
      if (grouped[task.status]) grouped[task.status].push(task);
      else grouped['To-Do'].push(task);
    }
    return grouped;
  }, [filteredTasks]);

  const filteredReports = useMemo(() => {
    const query = reportSearch.trim().toLowerCase();
    if (!query) return reports;
    return reports.filter(
      (r) =>
        r.intern_name.toLowerCase().includes(query) ||
        r.accomplishments?.toLowerCase().includes(query) ||
        r.blockers?.toLowerCase().includes(query)
    );
  }, [reports, reportSearch]);

  const attendanceSummary = useMemo(() => {
    const byIntern = new Map();
    for (const record of attendance) {
      const entry = byIntern.get(record.intern_name) || { name: record.intern_name, present: 0, late: 0, absent: 0, total: 0 };
      entry.total += 1;
      if (record.status === 'Present') entry.present += 1;
      else if (record.status === 'Late') entry.late += 1;
      else entry.absent += 1;
      byIntern.set(record.intern_name, entry);
    }
    return Array.from(byIntern.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [attendance]);

  // -- Task mutations -----------------------------------------------------------

  const moveTask = async (task, direction) => {
    const currentIndex = STATUS_ORDER.indexOf(task.status);
    const nextIndex = currentIndex + direction;
    if (nextIndex < 0 || nextIndex >= STATUS_ORDER.length) return;
    const nextStatus = STATUS_ORDER[nextIndex];

    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, status: nextStatus } : t)));

    const { error: updateError } = await supabase
      .from('tasks')
      .update({ status: nextStatus })
      .eq('id', task.id);

    if (updateError) {
      setError(updateError.message);
      setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, status: task.status } : t)));
    }
  };

  const openNewTaskDrawer = () => {
    setEditingTask(null);
    setTaskForm(EMPTY_TASK_FORM);
    setDrawerOpen(true);
  };

  const openEditTaskDrawer = (task) => {
    setEditingTask(task);
    setTaskForm({
      task_name: task.task_name,
      assignee: task.assignee,
      priority: task.priority,
      due_date: task.due_date || '',
      hours_logged: task.hours_logged ? String(task.hours_logged) : '',
    });
    setDrawerOpen(true);
  };

  const deleteTask = async (task) => {
    if (!window.confirm(`Delete "${task.task_name}"? This can't be undone.`)) return;

    const previous = tasks;
    setTasks((prev) => prev.filter((t) => t.id !== task.id));

    const { error: deleteError } = await supabase.from('tasks').delete().eq('id', task.id);
    if (deleteError) {
      setError(deleteError.message);
      setTasks(previous);
    }
  };

  const handleTaskFormChange = (field) => (event) => {
    setTaskForm((prev) => ({ ...prev, [field]: event.target.value }));
  };

  const submitTask = async (event) => {
    event.preventDefault();
    if (!taskForm.task_name.trim() || !taskForm.assignee.trim()) return;

    setSavingTask(true);
    const payload = {
      task_name: taskForm.task_name.trim(),
      assignee: taskForm.assignee.trim(),
      priority: taskForm.priority,
      due_date: taskForm.due_date || null,
      hours_logged: taskForm.hours_logged === '' ? 0 : Number(taskForm.hours_logged),
    };

    const { error: mutationError } = editingTask
      ? await supabase.from('tasks').update(payload).eq('id', editingTask.id)
      : await supabase.from('tasks').insert({ ...payload, status: 'To-Do' });

    setSavingTask(false);

    if (mutationError) {
      setError(mutationError.message);
      return;
    }

    setTaskForm(EMPTY_TASK_FORM);
    setEditingTask(null);
    setDrawerOpen(false);
    loadAll();
  };

  // -- Report mutations ---------------------------------------------------------

  const handleReportFormChange = (field) => (event) => {
    setReportForm((prev) => ({ ...prev, [field]: event.target.value }));
  };

  const submitReport = async (event) => {
    event.preventDefault();
    if (!reportForm.intern_name.trim() || !reportForm.accomplishments.trim()) return;

    setSavingReport(true);
    const { error: insertError } = await supabase.from('reports').insert({
      intern_name: reportForm.intern_name.trim(),
      accomplishments: reportForm.accomplishments.trim(),
      blockers: reportForm.blockers.trim() || null,
      next_steps: reportForm.next_steps.trim() || null,
    });
    setSavingReport(false);

    if (insertError) {
      setError(insertError.message);
      return;
    }

    setReportForm(EMPTY_REPORT_FORM);
    setReportOpen(false);
    loadAll();
  };

  const exportReportsCsv = () => {
    downloadCsv('reports.csv', filteredReports, [
      { key: 'intern_name', label: 'Intern' },
      { key: 'submission_date', label: 'Date' },
      { key: 'accomplishments', label: 'Accomplishments' },
      { key: 'blockers', label: 'Blockers' },
      { key: 'next_steps', label: 'Next steps' },
    ]);
  };

  // -- Attendance mutations -------------------------------------------------------

  const handleCheckinFormChange = (field) => (event) => {
    setCheckinForm((prev) => ({ ...prev, [field]: event.target.value }));
  };

  const submitCheckin = async (event) => {
    event.preventDefault();
    if (!checkinForm.intern_name.trim()) return;

    setSavingCheckin(true);
    const { error: upsertError } = await supabase
      .from('attendance')
      .upsert(
        {
          intern_name: checkinForm.intern_name.trim(),
          date: todayIso(),
          status: checkinForm.status,
        },
        { onConflict: 'intern_name,date' }
      );
    setSavingCheckin(false);

    if (upsertError) {
      setError(upsertError.message);
      return;
    }

    setCheckinForm((prev) => ({ ...prev, status: 'Present' }));
    loadAll();
  };

  // -- Render -----------------------------------------------------------------

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <div className="mx-auto w-full max-w-7xl flex-1 px-6 py-8">
        <TopBar
          view={view}
          onChangeView={setView}
          onNewTask={openNewTaskDrawer}
          onSubmitReport={() => setReportOpen(true)}
          theme={theme}
          onToggleTheme={toggleTheme}
        />

        <MetricsRow metrics={metrics} />

        {error && (
          <div className="mt-6 flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-600 dark:text-rose-300">
            <AlertTriangle size={16} />
            {error}
          </div>
        )}

        {loading ? (
          <div className="mt-16 text-center text-slate-500">Loading…</div>
        ) : view === 'board' ? (
          <>
            <FilterBar
              searchText={searchText}
              onSearchChange={setSearchText}
              priorityFilter={priorityFilter}
              onPriorityChange={setPriorityFilter}
            />
            <div className="mt-4 grid grid-cols-1 gap-8 lg:grid-cols-[1fr_320px]">
              <KanbanBoard
                tasksByStatus={tasksByStatus}
                onMove={moveTask}
                onEdit={openEditTaskDrawer}
                onDelete={deleteTask}
              />
              <RecentReports reports={reports.slice(0, 6)} onSeeAll={() => setView('reports')} />
            </div>
          </>
        ) : view === 'reports' ? (
          <ReportsPage
            reports={filteredReports}
            search={reportSearch}
            onSearchChange={setReportSearch}
            onExport={exportReportsCsv}
          />
        ) : (
          <AttendancePage
            attendance={attendance}
            summary={attendanceSummary}
            form={checkinForm}
            saving={savingCheckin}
            onChange={handleCheckinFormChange}
            onSubmit={submitCheckin}
          />
        )}
      </div>

      <Footer />

      <TaskDrawer
        open={drawerOpen}
        editing={Boolean(editingTask)}
        form={taskForm}
        saving={savingTask}
        onChange={handleTaskFormChange}
        onClose={() => setDrawerOpen(false)}
        onSubmit={submitTask}
      />

      <ReportDrawer
        open={reportOpen}
        form={reportForm}
        saving={savingReport}
        onChange={handleReportFormChange}
        onClose={() => setReportOpen(false)}
        onSubmit={submitReport}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Top bar: logo, name, view tabs, actions, theme toggle
// ---------------------------------------------------------------------------

function TopBar({ view, onChangeView, onNewTask, onSubmitReport, theme, onToggleTheme }) {
  return (
    <header className="border-b border-slate-200 pb-6 dark:border-slate-800">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3">
          {/* Place your logo file at public/logo.png in the project root */}
          <img
            src="/logo.png"
            alt="SarbahTek Solutions"
            className="h-10 w-10 rounded-lg object-contain"
            onError={(e) => {
              e.currentTarget.style.display = 'none';
            }}
          />
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-orange-500 dark:text-orange-400">
              SarbahTek Solutions
            </p>
            <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-white">
              Internship Activity Tracker
            </h1>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <nav className="flex rounded-lg border border-slate-300 bg-white p-1 dark:border-slate-700 dark:bg-slate-900">
            <TabButton
              active={view === 'board'}
              onClick={() => onChangeView('board')}
              icon={<LayoutGrid size={14} />}
              label="Board"
            />
            <TabButton
              active={view === 'reports'}
              onClick={() => onChangeView('reports')}
              icon={<FileText size={14} />}
              label="Reports"
            />
            <TabButton
              active={view === 'attendance'}
              onClick={() => onChangeView('attendance')}
              icon={<CalendarCheck size={14} />}
              label="Attendance"
            />
          </nav>

          <button
            onClick={onToggleTheme}
            aria-label="Toggle color theme"
            className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white p-2 text-slate-600 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>

          <button
            onClick={onSubmitReport}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-slate-600 dark:hover:bg-slate-800"
          >
            <Send size={16} />
            Submit report
          </button>
          <button
            onClick={onNewTask}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500"
          >
            <Plus size={16} />
            New task
          </button>
        </div>
      </div>
    </header>
  );
}

function TabButton({ active, onClick, icon, label }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition ${
        active
          ? 'bg-indigo-600 text-white'
          : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function MetricsRow({ metrics }) {
  return (
    <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <MetricCard
        icon={<ListChecks size={18} className="text-indigo-500 dark:text-indigo-400" />}
        label="Total tasks"
        value={metrics.total}
      />
      <MetricCard
        icon={<Gauge size={18} className="text-emerald-500 dark:text-emerald-400" />}
        label="Completion rate"
        value={`${metrics.completion}%`}
      />
      <MetricCard
        icon={<Clock3 size={18} className="text-sky-500 dark:text-sky-400" />}
        label="Hours logged"
        value={metrics.totalHours}
      />
      <MetricCard
        icon={<AlertTriangle size={18} className="text-amber-500 dark:text-amber-400" />}
        label="Active blockers"
        value={metrics.activeBlockers}
      />
    </div>
  );
}

function MetricCard({ icon, label, value }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900/60">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800">
        {icon}
      </div>
      <div>
        <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
        <p className="text-lg font-semibold text-slate-900 dark:text-white">{value}</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Filter bar (board view)
// ---------------------------------------------------------------------------

function FilterBar({ searchText, onSearchChange, priorityFilter, onPriorityChange }) {
  return (
    <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="relative flex-1">
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
        <input
          type="text"
          value={searchText}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search tasks by name or assignee"
          className={`${INPUT_CLASS} pl-9`}
        />
      </div>
      <select
        value={priorityFilter}
        onChange={(e) => onPriorityChange(e.target.value)}
        className={INPUT_CLASS}
      >
        {PRIORITY_OPTIONS.map((p) => (
          <option key={p} value={p}>
            {p === 'All' ? 'All priorities' : p}
          </option>
        ))}
      </select>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Kanban board
// ---------------------------------------------------------------------------

function KanbanBoard({ tasksByStatus, onMove, onEdit, onDelete }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {STATUS_ORDER.map((status) => (
        <KanbanColumn
          key={status}
          status={status}
          tasks={tasksByStatus[status]}
          onMove={onMove}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}

function KanbanColumn({ status, tasks, onMove, onEdit, onDelete }) {
  const meta = COLUMN_META[status];
  return (
    <div className="flex flex-col rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/40">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${meta.accent}`} />
          <h2 className="text-sm font-medium text-slate-700 dark:text-slate-200">{status}</h2>
        </div>
        <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-400">
          {tasks.length}
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-3 p-3">
        {tasks.length === 0 ? (
          <p className="px-1 py-6 text-center text-xs text-slate-400 dark:text-slate-600">Nothing here yet.</p>
        ) : (
          tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              status={status}
              onMove={onMove}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ))
        )}
      </div>
    </div>
  );
}

function TaskCard({ task, status, onMove, onEdit, onDelete }) {
  const isFirst = STATUS_ORDER.indexOf(status) === 0;
  const isLast = STATUS_ORDER.indexOf(status) === STATUS_ORDER.length - 1;
  const overdue = isOverdue(task);
  const hours = Number(task.hours_logged) || 0;

  return (
    <div
      className={`rounded-lg border bg-white p-3 shadow-sm shadow-slate-200/60 dark:bg-slate-900 dark:shadow-black/20 ${
        overdue
          ? 'border-rose-400/60 ring-1 ring-rose-500/20 dark:border-rose-500/40'
          : 'border-slate-200 dark:border-slate-800'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium leading-snug text-slate-900 dark:text-slate-100">{task.task_name}</p>
        <span
          className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium ${PRIORITY_META[task.priority] || PRIORITY_META.Medium}`}
        >
          {task.priority}
        </span>
      </div>

      <div className="mt-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-200 text-[11px] font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300">
            {initials(task.assignee)}
          </span>
          <span className="text-xs text-slate-500 dark:text-slate-400">{task.assignee}</span>
        </div>
        <div
          className={`flex items-center gap-1 text-xs ${
            overdue ? 'text-rose-600 dark:text-rose-400' : 'text-slate-400 dark:text-slate-500'
          }`}
        >
          <Clock size={12} />
          {formatDate(task.due_date)}
          {overdue && <span className="font-medium">· overdue</span>}
        </div>
      </div>

      {hours > 0 && (
        <div className="mt-1.5 flex items-center gap-1 text-xs text-slate-400 dark:text-slate-500">
          <Clock3 size={12} />
          {hours}h logged
        </div>
      )}

      <div className="mt-3 flex items-center justify-between border-t border-slate-200 pt-2 dark:border-slate-800">
        <div className="flex items-center gap-1">
          <button
            onClick={() => onEdit(task)}
            className="rounded-md p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            aria-label="Edit task"
          >
            <Pencil size={14} />
          </button>
          <button
            onClick={() => onDelete(task)}
            className="rounded-md p-1 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 dark:text-slate-500 dark:hover:bg-rose-500/10 dark:hover:text-rose-400"
            aria-label="Delete task"
          >
            <Trash2 size={14} />
          </button>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => onMove(task, -1)}
            disabled={isFirst}
            className="rounded-md p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-30 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            aria-label="Move to previous status"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            onClick={() => onMove(task, 1)}
            disabled={isLast}
            className="rounded-md p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-30 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            aria-label="Move to next status"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recent reports feed (board view sidebar)
// ---------------------------------------------------------------------------

function RecentReports({ reports, onSeeAll }) {
  return (
    <aside className="flex flex-col rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/40">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        <div className="flex items-center gap-2">
          <Users size={16} className="text-indigo-500 dark:text-indigo-400" />
          <h2 className="text-sm font-medium text-slate-700 dark:text-slate-200">Recent submissions</h2>
        </div>
        <button
          onClick={onSeeAll}
          className="text-xs font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300"
        >
          See all
        </button>
      </div>

      <div className="flex flex-col divide-y divide-slate-200 dark:divide-slate-800">
        {reports.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-slate-400 dark:text-slate-600">No reports submitted yet.</p>
        ) : (
          reports.map((report) => (
            <div key={report.id} className="px-4 py-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{report.intern_name}</p>
                <span className="text-xs text-slate-400 dark:text-slate-500">{formatDate(report.submission_date)}</span>
              </div>
              <p className="mt-1 line-clamp-2 text-xs text-slate-500 dark:text-slate-400">{report.accomplishments}</p>
              {report.blockers && (
                <p className="mt-1 flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                  <AlertTriangle size={11} />
                  {report.blockers}
                </p>
              )}
            </div>
          ))
        )}
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Dedicated reports page
// ---------------------------------------------------------------------------

function ReportsPage({ reports, search, onSearchChange, onExport }) {
  return (
    <div className="mt-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 sm:max-w-sm">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search by intern name or content"
            className={`${INPUT_CLASS} pl-9`}
          />
        </div>
        <button
          onClick={onExport}
          disabled={reports.length === 0}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-slate-600 dark:hover:bg-slate-800"
        >
          <Download size={16} />
          Export CSV
        </button>
      </div>

      <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
        {reports.length === 0 ? (
          <p className="bg-slate-50 px-4 py-10 text-center text-sm text-slate-400 dark:bg-slate-900/40 dark:text-slate-600">
            No reports match your search.
          </p>
        ) : (
          <div className="divide-y divide-slate-200 dark:divide-slate-800">
            {reports.map((report) => (
              <div key={report.id} className="bg-slate-50 px-5 py-4 dark:bg-slate-900/40">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-200 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                      {initials(report.intern_name)}
                    </span>
                    <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{report.intern_name}</p>
                  </div>
                  <span className="text-xs text-slate-400 dark:text-slate-500">{formatDate(report.submission_date)}</span>
                </div>

                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <ReportField label="Accomplishments" value={report.accomplishments} />
                  <ReportField label="Blockers" value={report.blockers} tone={report.blockers ? 'warn' : 'muted'} />
                  <ReportField label="Next steps" value={report.next_steps} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ReportField({ label, value, tone = 'default' }) {
  const toneClass =
    tone === 'warn'
      ? 'text-amber-600 dark:text-amber-400'
      : tone === 'muted'
      ? 'text-slate-400 dark:text-slate-600'
      : 'text-slate-700 dark:text-slate-300';
  return (
    <div>
      <p className="text-xs font-medium text-slate-500 dark:text-slate-500">{label}</p>
      <p className={`mt-1 text-sm ${toneClass}`}>{value || '—'}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Attendance page
// ---------------------------------------------------------------------------

function AttendancePage({ attendance, summary, form, saving, onChange, onSubmit }) {
  return (
    <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[320px_1fr]">
      <div className="flex flex-col gap-6">
        <form
          onSubmit={onSubmit}
          className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900/60"
        >
          <h2 className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
            <CalendarCheck size={16} className="text-indigo-500 dark:text-indigo-400" />
            Check in for today
          </h2>
          <div className="mt-4 flex flex-col gap-3">
            <input
              type="text"
              required
              value={form.intern_name}
              onChange={onChange('intern_name')}
              placeholder="Your name"
              className={INPUT_CLASS}
            />
            <div className="flex gap-2">
              {ATTENDANCE_STATUSES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => onChange('status')({ target: { value: s } })}
                  className={`flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition ${
                    form.status === s
                      ? ATTENDANCE_STATUS_META[s]
                      : 'border-slate-300 text-slate-500 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-indigo-600 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:opacity-50"
            >
              {saving ? 'Checking in…' : 'Check in'}
            </button>
          </div>
          <p className="mt-2 text-xs text-slate-400 dark:text-slate-600">
            Checking in again today updates your existing entry instead of creating a duplicate.
          </p>
        </form>

        <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/60">
          <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-800">
            <h2 className="text-sm font-medium text-slate-700 dark:text-slate-200">Per-intern summary</h2>
          </div>
          <div className="flex flex-col divide-y divide-slate-200 dark:divide-slate-800">
            {summary.length === 0 ? (
              <p className="px-4 py-6 text-center text-xs text-slate-400 dark:text-slate-600">No check-ins yet.</p>
            ) : (
              summary.map((s) => (
                <div key={s.name} className="flex items-center justify-between px-4 py-3">
                  <span className="text-sm font-medium text-slate-900 dark:text-slate-100">{s.name}</span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    {s.present} present · {s.late} late · {s.absent} absent
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/60">
        <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <h2 className="text-sm font-medium text-slate-700 dark:text-slate-200">Attendance log</h2>
        </div>
        <div className="flex flex-col divide-y divide-slate-200 dark:divide-slate-800">
          {attendance.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-slate-400 dark:text-slate-600">
              No check-ins recorded yet.
            </p>
          ) : (
            attendance.map((record) => (
              <div key={record.id} className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-200 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                    {initials(record.intern_name)}
                  </span>
                  <span className="text-sm text-slate-900 dark:text-slate-100">{record.intern_name}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-slate-400 dark:text-slate-500">{formatDate(record.date)}</span>
                  <span
                    className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${
                      ATTENDANCE_STATUS_META[record.status] || ATTENDANCE_STATUS_META.Present
                    }`}
                  >
                    {record.status}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Task creation / edit drawer
// ---------------------------------------------------------------------------

function TaskDrawer({ open, editing, form, saving, onChange, onClose, onSubmit }) {
  return (
    <Drawer open={open} onClose={onClose} title={editing ? 'Edit task' : 'New task'}>
      <form onSubmit={onSubmit} className="flex flex-1 flex-col gap-4 p-5">
        <Field label="Task name">
          <input
            type="text"
            required
            value={form.task_name}
            onChange={onChange('task_name')}
            placeholder="e.g. Draft project scope"
            className={INPUT_CLASS}
          />
        </Field>

        <Field label="Assignee">
          <input
            type="text"
            required
            value={form.assignee}
            onChange={onChange('assignee')}
            placeholder="e.g. Seth Smart"
            className={INPUT_CLASS}
          />
        </Field>

        <Field label="Priority">
          <select value={form.priority} onChange={onChange('priority')} className={INPUT_CLASS}>
            <option value="High">High</option>
            <option value="Medium">Medium</option>
            <option value="Low">Low</option>
          </select>
        </Field>

        <Field label="Due date">
          <input type="date" value={form.due_date} onChange={onChange('due_date')} className={INPUT_CLASS} />
        </Field>

        <Field label="Hours logged">
          <input
            type="number"
            min="0"
            step="0.5"
            value={form.hours_logged}
            onChange={onChange('hours_logged')}
            placeholder="e.g. 2.5"
            className={INPUT_CLASS}
          />
        </Field>

        <div className="mt-auto flex gap-3 pt-4">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-lg border border-slate-300 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="flex-1 rounded-lg bg-indigo-600 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:opacity-50"
          >
            {saving ? 'Saving…' : editing ? 'Save changes' : 'Add task'}
          </button>
        </div>
      </form>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
// Report submission drawer
// ---------------------------------------------------------------------------

function ReportDrawer({ open, form, saving, onChange, onClose, onSubmit }) {
  return (
    <Drawer open={open} onClose={onClose} title="Submit report">
      <form onSubmit={onSubmit} className="flex flex-1 flex-col gap-4 p-5">
        <Field label="Your name">
          <input
            type="text"
            required
            value={form.intern_name}
            onChange={onChange('intern_name')}
            placeholder="e.g. Margaret COE"
            className={INPUT_CLASS}
          />
        </Field>

        <Field label="Accomplishments">
          <textarea
            required
            rows={4}
            value={form.accomplishments}
            onChange={onChange('accomplishments')}
            placeholder="What did you get done today?"
            className={`${INPUT_CLASS} resize-none`}
          />
        </Field>

        <Field label="Blockers or challenges">
          <textarea
            rows={3}
            value={form.blockers}
            onChange={onChange('blockers')}
            placeholder="Anything slowing you down? Leave blank if none."
            className={`${INPUT_CLASS} resize-none`}
          />
        </Field>

        <Field label="Next steps">
          <textarea
            rows={3}
            value={form.next_steps}
            onChange={onChange('next_steps')}
            placeholder="What's next?"
            className={`${INPUT_CLASS} resize-none`}
          />
        </Field>

        <div className="mt-auto flex gap-3 pt-4">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-lg border border-slate-300 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="flex-1 rounded-lg bg-indigo-600 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:opacity-50"
          >
            {saving ? 'Submitting…' : 'Submit report'}
          </button>
        </div>
      </form>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
// Shared drawer shell + field wrapper
// ---------------------------------------------------------------------------

function Drawer({ open, onClose, title, children }) {
  return (
    <div
      className={`fixed inset-0 z-50 transition ${open ? 'pointer-events-auto' : 'pointer-events-none'}`}
      aria-hidden={!open}
    >
      <div
        onClick={onClose}
        className={`absolute inset-0 bg-black/40 transition-opacity dark:bg-black/50 ${open ? 'opacity-100' : 'opacity-0'}`}
      />
      <div
        className={`absolute right-0 top-0 flex h-full w-full max-w-sm flex-col border-l border-slate-200 bg-white shadow-2xl transition-transform duration-200 dark:border-slate-800 dark:bg-slate-950 ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">{title}</h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</span>
      {children}
    </label>
  );
}

// ---------------------------------------------------------------------------
// Footer
// ---------------------------------------------------------------------------

function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-slate-200 bg-slate-50 px-6 py-4 text-center text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-500">
      © {year} SarbahTek Solutions. <br/>
      Developed by Seth Smart & Margaret. All rights reserved
    </footer>
  );
}