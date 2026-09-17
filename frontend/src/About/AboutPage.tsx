import FullNavigation from "../FullNavigation/FullNavigation";
import About from "./About";
import { PageTour } from "../shared/tour/PageTour";
import { useParams } from "react-router-dom";

export default function AboutPage() {
  const { subpageID } = useParams();
  return (
    <>
      <FullNavigation pageName={subpageID ? undefined : "about"} />
      <PageTour tourId="about" />
      <About subpageID={subpageID} />
    </>
  );
}
