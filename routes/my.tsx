import ClassroomAdmin from "../islands/ClassroomAdmin.tsx";

export default function MyClassroom() {
  return (
    <main
      class="min-h-screen bg-slate-50 px-4 py-8"
      style={{ backgroundImage: "url('/lines.svg')", backgroundSize: "cover" }}
    >
      <div class="mx-auto mb-6 max-w-5xl">
        <a
          href="/"
          class="text-sm font-semibold text-indigo-700 hover:underline"
        >
          ← Buddy
        </a>
      </div>
      <ClassroomAdmin brand="Buddy" />
    </main>
  );
}
