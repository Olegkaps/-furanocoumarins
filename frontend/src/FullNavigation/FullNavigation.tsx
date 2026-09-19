import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  CircleInfo,
  ClockArrowRotateLeft,
  Database,
  FileCode,
  BookOpen,
  Picture,
  Gear,
  Magnifier,
  Archive,
} from "@gravity-ui/icons";
import { isTokenExists } from "../shared/api";
import { useAboutSubpages } from "../About/useAboutSubpages";
import { AboutIcon } from "../About/aboutSubpages";

function NavIcon({
  to,
  title,
  current,
  className,
  children,
}: {
  to: string;
  title: string;
  current?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const cls = `nav-icon-link${className ? ` ${className}` : ""}${current ? " is-current" : ""}`;
  if (current) {
    return (
      <span
        className={cls}
        title={title}
        aria-label={title}
        aria-current="page"
      >
        {children}
      </span>
    );
  }
  return (
    <Link
      to={to}
      target="_blank"
      className={cls}
      title={title}
      aria-label={title}
    >
      {children}
    </Link>
  );
}

export interface FullNavigationProps {
  /** Mark this page’s icon as selected and non-clickable */
  pageName?: "home" | "about" | "history" | "cache" | "catalog" | "admin" | "metadata" | "publication-reader" | "images";
}

export default function FullNavigation({ pageName }: FullNavigationProps) {
  const [isAdmin, setIsAdmin] = useState(() => isTokenExists());
  const { pages: aboutPages } = useAboutSubpages();

  useEffect(() => {
    const sync = () => setIsAdmin(isTokenExists());
    sync();
    window.addEventListener("storage", sync);
    window.addEventListener("focus", sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("focus", sync);
    };
  }, []);

  return (
    <nav className="site-nav" aria-label="Site" data-tour="nav">
      <div className="site-nav__main">
        <NavIcon to="/search" title="Search" current={pageName === "home"}>
          <Magnifier width={28} height={28} />
        </NavIcon>
        <div className="about-nav-menu">
          <NavIcon to="/about" title="About" current={pageName === "about"}>
            <CircleInfo width={28} height={28} />
          </NavIcon>
          {aboutPages.length > 0 && <div className="about-nav-menu__items" aria-label="About subpages">
            {aboutPages.map((page) => <Link key={page.id} to={`/about/${page.id}`}><AboutIcon icon={page.icon} size={18} /><span>{page.name}</span></Link>)}
          </div>}
        </div>
        <NavIcon to="/catalog" title="Data catalog" current={pageName === "catalog"}>
          <Archive width={28} height={28} />
        </NavIcon>
        <NavIcon
          to="/history"
          title="Query history"
          current={pageName === "history"}
        >
          <ClockArrowRotateLeft width={28} height={28} />
        </NavIcon>
        <NavIcon to="/cache" title="API cache" current={pageName === "cache"}>
          <Database width={28} height={28} />
        </NavIcon>
      </div>
      {isAdmin && (
        <div
          className="nav-admin-group"
          data-tour="nav-admin"
          title="Admin only"
        >
          <span className="nav-admin-group__label">Admin</span>
          <NavIcon
            to="/admin"
            title="Admin panel"
            current={pageName === "admin"}
            className="nav-icon-link--admin"
          >
            <Gear width={28} height={28} />
          </NavIcon>
          <NavIcon
            to="/admin/metadata"
            title="Metadata"
            current={pageName === "metadata"}
            className="nav-icon-link--admin"
          >
            <FileCode width={28} height={28} />
          </NavIcon>
          <NavIcon to="/admin/publication-reader" title="Publication reader" current={pageName === "publication-reader"} className="nav-icon-link--admin">
            <BookOpen width={28} height={28} />
          </NavIcon>
          <NavIcon to="/admin/images" title="Image library" current={pageName === "images"} className="nav-icon-link--admin">
            <Picture width={28} height={28} />
          </NavIcon>
        </div>
      )}
    </nav>
  );
}
