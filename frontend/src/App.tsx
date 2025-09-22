import {
  BrowserRouter,
  Routes,
  Route,
} from "react-router-dom";


import './App.css'
import SearchApp from "./SearchApp/SearchApp";
import Admin from "./Admin/Admin";


function App() {
  return (
    <BrowserRouter>
      <Routes>
          <Route path="/" element={<SearchApp />}/>
          <Route path="/login" element={<Admin.Login />}/>
          <Route path="/logout" element={<Admin.Logout />}/>
          <Route path="/reset" element={<Admin.Reset />}/>
          <Route path="/admit/:code" element={<Admin.Admit />}/>
          <Route path="/admin" element={<Admin.App />}/>
      </Routes>
    </BrowserRouter>
  )
}

export default App
