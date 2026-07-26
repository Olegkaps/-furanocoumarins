import FullNavigation from "../FullNavigation/FullNavigation";
import About from "./About";
import { PageTour } from "../shared/tour/PageTour";

export default function AboutPage() {
  return (
    <>
      <FullNavigation pageName="about" />
      <PageTour tourId="about" />
      <About />
    </>
  );
}
