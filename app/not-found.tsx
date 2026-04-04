export const dynamic = 'force-dynamic';

export default function NotFound() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-black text-white">
      <div className="text-center">
        <p className="text-sm uppercase tracking-widest text-white/40 mb-2">404</p>
        <p className="text-white/60 text-sm">Page not found</p>
      </div>
    </div>
  );
}
