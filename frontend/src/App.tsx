import {
  BrowserRouter,
  Routes,
  Route,
} from "react-router-dom";


import './App.css'
import SearchApp, { AppPhilogeneticTree, AppResultTable } from "./SearchApp/SearchApp";
import AboutPage from "./About/AboutPage";
import { AdminApp, AdminLogin, AdminLogout, AdminReset, AdminAdmit } from "./Admin/Admin";
import { Reference } from "./Reference/Reference";
import SubstancePage from "./SubstancePage/SubstancePage";


function App() {
  return (
    <BrowserRouter>
      <Routes>
          <Route path="/" element={<SearchApp />}/>
          <Route path="/about" element={<AboutPage />}/>
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
    </BrowserRouter>
  )
}

export default App
