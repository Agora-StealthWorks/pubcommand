/** The public link page frame. */
export default function PublicTrackRecordLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-canvas px-4 py-8">
      <div className="mx-auto max-w-4xl">{children}</div>
    </main>
  );
}
