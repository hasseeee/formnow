import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { ToastProvider } from './components/Toast';
import LandingPage from './pages/LandingPage';
import NotFoundPage from './pages/NotFoundPage';
import PublicFormPage from './pages/public/PublicFormPage';
import AdminTokenGate from './pages/admin/AdminTokenGate';
import AdminHome from './pages/admin/AdminHome';
import EventDetailPage from './pages/admin/EventDetailPage';
import FormEditPage from './pages/admin/FormEditPage';
import FormResultsPage from './pages/admin/FormResultsPage';

export default function App() {
  return (
    <ToastProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/f/:slug" element={<PublicFormPage />} />
          <Route path="/admin" element={<AdminTokenGate />}>
            <Route index element={<AdminHome />} />
            <Route path="events/:id" element={<EventDetailPage />} />
            <Route path="forms/:id" element={<FormEditPage />} />
            <Route path="forms/:id/results" element={<FormResultsPage />} />
          </Route>
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </BrowserRouter>
    </ToastProvider>
  );
}
