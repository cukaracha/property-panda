import { Routes, Route, Navigate } from 'react-router-dom';
import AppLayout from './layouts/AppLayout';
import Profile from './pages/profile/Profile';
import PropertySearch from './pages/propertySearch/PropertySearch';

function App() {
  return (
    <Routes>
      <Route path='/' element={<AppLayout />}>
        <Route index element={<Navigate to='/properties' replace />} />
        <Route path='properties' element={<PropertySearch />} />
        <Route path='profile' element={<Profile />} />
      </Route>
      <Route path='*' element={<Navigate to='/properties' replace />} />
    </Routes>
  );
}

export default App;
