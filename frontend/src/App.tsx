import {
  BrowserRouter,
  Routes,
  Route,
} from "react-router-dom";


import './App.css'
import SearchApp, { AppPhilogeneticTree, AppResultTable, AppAbout } from "./SearchApp/SearchApp";
import Admin from "./Admin/Admin";
import { Reference } from "./SearchApp/DataMeta";


function App() {
  return (
    <BrowserRouter>
      <Routes>
          <Route path="/" element={<SearchApp />}/>
          <Route path="/about" element={<AppAbout />}/>
          <Route path="/table" element={<AppResultTable />}/>
          <Route path="/tree" element={<AppPhilogeneticTree />}/>
          <Route path="/login" element={<Admin.Login />}/>
          <Route path="/logout" element={<Admin.Logout />}/>
          <Route path="/reset" element={<Admin.Reset />}/>
          <Route path="/admit/:code" element={<Admin.Admit />}/>
          <Route path="/admin" element={<Admin.App />}/>
          <Route path="/reference/:article_id" element={<Reference />}/>
      </Routes>
    </BrowserRouter>
  )
}

export default App
