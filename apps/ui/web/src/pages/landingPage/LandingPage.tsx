import { Navigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import LoginForm from './components/LoginForm';

export default function LandingPage() {
  const { isAuthenticated } = useAuth();

  if (isAuthenticated) {
    return <Navigate to='/' replace />;
  }

  // LoginForm renders the full-viewport split frame (brand panel + form
  // panel) and swaps its copy between the sign-in and set-new-password states.
  return <LoginForm />;
}
