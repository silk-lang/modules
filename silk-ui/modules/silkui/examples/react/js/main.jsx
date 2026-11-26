import { useState } from "react";
import { createRoot } from "@silkui/react";

function Counter() {
  const [clicks, setClicks] = useState(0);
  return (
    <box style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "rgb(250, 250, 250)", fontFamily: "sans-serif" }}>
      <box
        tabIndex={0}
        cursor="pointer"
        onClick={() => setClicks(clicks + 1)}
        style={{ paddingTop: 12, paddingBottom: 12, paddingLeft: 20, paddingRight: 20, borderRadius: 10, backgroundColor: "rgb(37, 99, 235)", color: "white", fontSize: 18 }}
        hoverStyle={{ backgroundColor: "rgb(59, 130, 246)" }}
      >
        {`Clicked ${clicks} time${clicks === 1 ? "" : "s"}`}
      </box>
    </box>
  );
}

createRoot().render(<Counter />);
