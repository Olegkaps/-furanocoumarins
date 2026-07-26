import config from "../config";

export function SiteFooter() {
  const initials = config["DEVELOPER_INITIALS"];
  return (
    <footer className="site-footer">
      <p className="site-footer__line">
        Developed by <span className="site-footer__initials">{initials}</span>
      </p>
    </footer>
  );
}
