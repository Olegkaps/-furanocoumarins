import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
} from "react-router-dom";


import './App.css'
import SearchApp, { AppPhilogeneticTree, AppResultTable } from "./SearchApp/SearchApp";
import AboutPage from "./About/AboutPage";
import { AdminApp, AdminLogin, AdminLogout, AdminReset, AdminAdmit } from "./Admin/Admin";
import { Reference } from "./Reference/Reference";
import SubstancePage from "./SubstancePage/SubstancePage";
import { SiteFooter } from "./shared/SiteFooter";


function App() {
  return (
    <BrowserRouter>
      <div className="app-shell">
        <div className="app-shell__main">
          <Routes>
              <Route path="/" element={<Navigate to="/about" />}/>
              <Route path="/search" element={<SearchApp />}/>
              <Route path="/about" element={<AboutPage />}/>
              <Route path="/page" element={<SubstancePage />}/>
              {/* Legacy path form; redirects via SubstancePage query parsing */}
              <Route path="/page/:smiles" element={<SubstancePage />}/>
              <Route path="/table" element={<AppResultTable />}/>
              <Route path="/tree" element={<AppPhilogeneticTree />}/>
              <Route path="/login" element={<AdminLogin />}/>
              <Route path="/logout" element={<AdminLogout />}/>
              <Route path="/reset" element={<AdminReset />}/>
              <Route path="/admit/:code" element={<AdminAdmit />}/>
              <Route path="/admin" element={<AdminApp />}/>
              <Route path="/reference/:article_id" element={<Reference />}/>
          </Routes>
        </div>
        <SiteFooter />
      </div>
    </BrowserRouter>
  )
}

export default App
