import { Routes, Route, Navigate } from 'react-router-dom';
import { ProtectedRoute } from './config/ProtectedRoute';
import AppLayout from './layouts/AppLayout';
import LandingPage from './pages/landingPage/LandingPage';
import Home from './pages/home/Home';
import Conversations from './pages/conversations/Conversations';
import Topic from './pages/topics/Topic';
import Profile from './pages/profile/Profile';
import UserManagement from './pages/userManagement/UserManagement';
import Converter from './pages/converter/Converter';
import Ontology from './pages/ontology/Ontology';

function App() {
  return (
    <Routes>
      <Route path='/login' element={<LandingPage />} />
      <Route
        path='/'
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Home />} />
        <Route path='conversations' element={<Conversations />} />
        <Route path='topics/:topicId' element={<Topic />} />
        <Route path='profile' element={<Profile />} />
        <Route path='converter' element={<Converter />} />
        <Route path='ontology' element={<Ontology />} />
        {/* Admin route is reachable, but the admin API handlers enforce the
            Admins group (403 for non-admins); the nav link is admin-only. */}
        <Route path='admin' element={<UserManagement />} />
      </Route>
      <Route path='*' element={<Navigate to='/' replace />} />
    </Routes>
  );
}

export default App;
