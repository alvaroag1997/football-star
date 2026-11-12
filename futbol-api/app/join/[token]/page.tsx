import App from '../../components/App';

// Enlace de invitación: /join/<token>
// Sin sesión se muestra la invitación con registro / inicio de sesión; con sesión entra al grupo.
export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <App inviteToken={token} />;
}
