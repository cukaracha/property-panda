import { Routes, Route, Navigate } from 'react-router-dom';
import AppLayout from './layouts/AppLayout';
import Profile from './pages/profile/Profile';
import PropertySearch from './pages/propertySearch/PropertySearch';
import PropertySearchResults from './pages/propertySearch/PropertySearchResults';
import Shortlist from './pages/shortlist/Shortlist';

function App() {
  return (
    <Routes>
      <Route path='/' element={<AppLayout />}>
        <Route index element={<Navigate to='/properties' replace />} />
        <Route path='properties' element={<PropertySearch />} />
        <Route path='properties/results' element={<PropertySearchResults />} />
        <Route path='shortlist' element={<Shortlist />} />
        <Route path='profile' element={<Profile />} />
      </Route>
      <Route path='*' element={<Navigate to='/properties' replace />} />
    </Routes>
  );
}

export default App;
