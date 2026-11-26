import { createRoot } from "@silkui/react";
import { Counter } from "../Counter.jsx";
import { mark } from "platform";

createRoot().render(<Counter />);
mark("first frame");
