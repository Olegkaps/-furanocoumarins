import { useState } from 'react'
import './App.css'

function App() {
  const [request, setRequest] = useState("")

  return (
    <>
      <div className="card">
        <form className="main_form" onSubmit={() => alert("your request is: " + request)}>
          <input type="text" className="search-teaxtarea" onChange={(text) => setRequest(text.target.value)}></input>
          <input type="submit" className="search-submit" value=">"/>
        </form>
      </div>
      <div className=""></div>
    </>
  )
}

export default App
