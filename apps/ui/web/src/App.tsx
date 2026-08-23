import { Routes, Route, Navigate } from 'react-router-dom';
import AppLayout from './layouts/AppLayout';
import AlwaysHidden from './pages/alwaysHidden/AlwaysHidden';
import Profile from './pages/profile/Profile';
import PropertySearch from './pages/propertySearch/PropertySearch';
import PropertySearchResults from './pages/propertySearch/PropertySearchResults';
import Shortlist from './pages/shortlist/Shortlist';

function App() {
  return (
    <Routes>
      <Route path='/' element={<AppLayout />}>
        <Route index element={<Navigate to='/search' replace />} />
        <Route path='search' element={<PropertySearch />} />
        <Route path='search/results' element={<PropertySearchResults />} />
        <Route path='shortlist' element={<Shortlist />} />
        <Route path='hidden' element={<AlwaysHidden />} />
        <Route path='profile' element={<Profile />} />
      </Route>
      <Route path='*' element={<Navigate to='/search' replace />} />
    </Routes>
  );
}

export default App;
