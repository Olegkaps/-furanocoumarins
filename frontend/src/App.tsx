import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
} from "react-router-dom";
import { useEffect, useState } from "react";


import './App.css'
import SearchApp, { AppPhilogeneticTree, AppResultTable } from "./SearchApp/SearchApp";
import AboutPage from "./About/AboutPage";
import { AdminApp, AdminLogin, AdminLogout, AdminReset, AdminAdmit, AdminMagicCallback } from "./Admin/Admin";
import Register from "./Admin/Register";
import { Reference } from "./Reference/Reference";
import SubstancePage from "./SubstancePage/SubstancePage";
import { SiteFooter } from "./shared/SiteFooter";
import HistoryPage from "./SearchApp/HistoryPage";
import CachePage from "./SearchApp/CachePage";
import { CacheSchemaBanner } from "./shared/CacheSchemaBanner";
import { restoreCookieSession } from "./shared/api";


function App() {
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    void restoreCookieSession().finally(() => setAuthReady(true));
  }, []);

  if (!authReady) {
    return <div className="app-shell"><main className="app-shell__main" aria-busy="true" /></div>;
  }

  return (
    <BrowserRouter>
      <div className="app-shell">
        <div className="app-shell__main">
          <CacheSchemaBanner />
          <Routes>
              <Route path="/" element={<Navigate to="/about" />}/>
              <Route path="/search" element={<SearchApp />}/>
              <Route path="/about" element={<AboutPage />}/>
              <Route path="/history" element={<HistoryPage />}/>
              <Route path="/cache" element={<CachePage />}/>
              <Route path="/page" element={<SubstancePage />}/>
              {/* Legacy path form; redirects via SubstancePage query parsing */}
              <Route path="/page/:smiles" element={<SubstancePage />}/>
              <Route path="/table" element={<AppResultTable />}/>
              <Route path="/tree" element={<AppPhilogeneticTree />}/>
              <Route path="/login" element={<AdminLogin />}/>
              <Route path="/logout" element={<AdminLogout />}/>
              <Route path="/reset" element={<AdminReset />}/>
              <Route path="/admit/:code" element={<AdminAdmit />}/>
			  <Route path="/admit" element={<AdminMagicCallback />}/>
			  <Route path="/register" element={<Register />}/>
              <Route path="/admin" element={<AdminApp />}/>
              <Route path="/admin/metadata" element={<AdminApp metadataPage />}/>
              <Route path="/reference/:article_id" element={<Reference />}/>
          </Routes>
        </div>
        <SiteFooter />
      </div>
    </BrowserRouter>
  )
}

export default App
