import { Link } from 'react-router-dom';
import { CircleInfo, House } from '@gravity-ui/icons';

function HomeLink() {
  return (
    <Link
      to="/"
      target="_blank"
      style={{
        position: 'absolute',
        left: '10px',
        top: '10px',
        backgroundColor: '#e1c8ff',
        border: '1px solid grey',
        borderRadius: '10px',
        padding: '10px 10px 5px 10px',
      }}
    >
      <House width={'30px'} height={'30px'} />
    </Link>
  );
}

function AboutLink() {
  return (
    <Link
      to="/about"
      target="_blank"
      style={{
        position: 'absolute',
        left: '70px',
        top: '10px',
        backgroundColor: '#e1c8ff',
        border: '1px solid grey',
        borderRadius: '10px',
        padding: '10px 10px 5px 10px',
      }}
    >
      <CircleInfo width={'30px'} height={'30px'} />
    </Link>
  );
}

export interface FullNavigationProps {
  /** Hide the navigation element for this page (e.g. "about" hides the About link on the About page) */
  pageName?: 'home' | 'about';
}

export default function FullNavigation({ pageName }: FullNavigationProps) {
  return (
    <>
      {pageName !== 'home' && <HomeLink />}
      {pageName !== 'about' && <AboutLink />}
    </>
  );
}
