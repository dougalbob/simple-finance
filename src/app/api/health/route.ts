/**
 * Public container health endpoint (blueprint §7): reveals no records,
 * identities, secrets or diagnostics — just that the server is up.
 */
export async function GET() {
  return Response.json({ status: 'ok' });
}
