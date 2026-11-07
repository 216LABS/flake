export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return Response.json({
    name: 'Flake route',
    short_name: 'Flake',
    start_url: `/d/${token}`,
    scope: `/d/${token}`,
    display: 'standalone',
    background_color: '#0b1016',
    theme_color: '#0b1016',
    icons: [{ src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
  });
}
