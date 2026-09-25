export default function UnauthorizedPage() {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center px-4 text-center">
      <h1 className="text-xl font-semibold">Not signed in</h1>
      <p className="mt-3 text-sm text-ink-soft">
        Simple Finance is a private application protected by Cloudflare Access. Open it through your
        usual household link so you arrive signed in with your Google identity.
      </p>
      <p className="mt-2 text-sm text-ink-muted">
        If you believe you should have access, ask the other household member to check the Access
        allowlist.
      </p>
    </main>
  );
}
