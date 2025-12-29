import axios from "axios"
import { jwtDecode } from 'jwt-decode';

import config from "../config"
import { useEffect, useRef, useState } from "react";



export function isEmpty(obj: object) {
  return Object.keys(obj).length === 0;
}

interface JwtPayload {
    name: string,
    role: string,
    created: number,
    exp: number,
}

let TOKEN = 'auth-token'
let NAME = 'name'

export const api = axios.create({ baseURL: config["BASE_URL"], headers: {'Access-Control-Allow-Origin': "true"} })


async function renew_token(token: string){
    return await api.post('/renew-token', {}, { headers: { Authorization: `Bearer ${token}` } }).catch((err) => {return err.response});
}

export function isTokenExists() {
    return getToken() !== undefined
}

export function getToken() {
    let token = localStorage.getItem(TOKEN)

    if (!token) {
        return undefined
    }
    try {
        let decoded = jwtDecode<JwtPayload>(token)
    
        if (Date.now()/1000 - decoded.created > (decoded.exp - decoded.created) / 2) {
            renew_token(token).then((response) => {
                if (response?.status === 200) {
                    setToken(response.data.token);    
                } else if (response?.status === 401) {
                    return undefined
                }
            })
        }
    }
    catch (error) {
        alert(error)
        return undefined
    }
    return localStorage.getItem(TOKEN)
}

export function delToken() {
    localStorage.removeItem(TOKEN)
    localStorage.removeItem(NAME)
}

export function setToken(token_value: string) {
    localStorage.setItem(TOKEN, token_value)
    let decoded = jwtDecode<JwtPayload>(token_value)
    localStorage.setItem(NAME, decoded.name)
}

export function getName() {
    return localStorage.getItem(NAME)
}

export function ZoomableContainer({children}: {children: React.ReactNode}) {
    const [zoomLevel, setZoomLevel] = useState(1);
    const containerRef = useRef<HTMLDivElement>(null);

    const handleWheel = (e: WheelEvent) => {
        e.preventDefault();

        const delta = e.deltaY;
        const newZoom = zoomLevel + (delta > 0 ? -0.1 : 0.1);
        let clampedZoom = Math.max(0.5, Math.min(newZoom, 1.1)); // 0.5x … 3x

        setZoomLevel(clampedZoom);
    };

    useEffect(() => {
        const container = containerRef.current;
        if (container) {
            container.addEventListener('wheel', handleWheel, { passive: false });
            return () => container.removeEventListener('wheel', handleWheel);
        }
    }, [zoomLevel]);

    return <div className="tree"
    style={{
        backgroundColor: 'white',
        padding: '30px',
        paddingRight: '70px',
        border: '1px solid #d4d4d4ff',
        borderRadius: '20px',
        maxHeight: '600px',
        maxWidth: '100%',
        overflow: 'scroll',
        position: 'relative',
    }}>
      <div
        ref={containerRef}
        className="smart-zoom-container"
        style={{
          zoom: zoomLevel,
          //WebkitZoom: zoomLevel, // for Safari
          display: 'block',
          width: '100%',
          backgroundColor: '#f9f9f9',
        }}
      >{children}</div></div>
}
