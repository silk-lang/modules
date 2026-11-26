// A chat transcript, the shape of the application this benchmark stands for: a list of
// messages, each with a header, paragraphs with inline marks, a code block and actions.
// One message is 30 host elements and 19 text nodes.
import { createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

const Theme = createContext({ accent: "#6a5acd", muted: "#888", mono: "monospace" });

const WORDS = ["render", "the", "tree", "of", "nodes", "with", "a", "stable", "layout", "and", "measure", "each", "phase", "once", "before", "paint"];

/** Deterministic text of `count` words for message `seed`. */
function words(seed, count) {
  let text = "";
  for (let index = 0; index < count; index++) {
    text += (index ? " " : "") + WORDS[(seed * 7 + index * 13) % WORDS.length];
  }
  return text;
}

export function makeMessage(id) {
  return {
    id,
    author: id % 3 === 0 ? "assistant" : "user",
    time: `${String(9 + (id % 12)).padStart(2, "0")}:${String(id % 60).padStart(2, "0")}`,
    paragraphs: [words(id, 18), words(id + 1, 24), words(id + 2, 12)],
    code: ["const tree = build(nodes);", `layout(tree, ${id});`, "paint(tree);"],
    liked: false,
  };
}

function Avatar({ author }) {
  const theme = useContext(Theme);
  return (
    <box className="avatar" style={{ width: 28, height: 28, borderRadius: 14, background: author === "assistant" ? theme.accent : theme.muted }}>
      <text>{author[0].toUpperCase()}</text>
    </box>
  );
}

function Header({ author, time }) {
  const theme = useContext(Theme);
  return (
    <box className="header" style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
      <Avatar author={author} />
      <text style={{ fontWeight: 600 }}>{author}</text>
      <text style={{ color: theme.muted, fontSize: 12 }}>{time}</text>
    </box>
  );
}

function Paragraph({ text }) {
  const cut = text.indexOf(" ", text.length >> 1);
  const head = text.slice(0, cut);
  const tail = text.slice(cut);
  return (
    <box className="paragraph" style={{ marginTop: 6 }}>
      <text>
        {head}
        <span style={{ fontWeight: 700 }}> marked</span>
        {tail}
      </text>
    </box>
  );
}

function Code({ lines }) {
  const theme = useContext(Theme);
  const style = useMemo(() => ({ fontFamily: theme.mono, padding: 8, background: "#111", borderRadius: 6 }), [theme]);
  return (
    <box className="code" style={style}>
      {lines.map((line, index) => (
        <box key={index} className="line" style={{ flexDirection: "row" }}>
          <text style={{ color: theme.muted, width: 24 }}>{index + 1}</text>
          <text>{line}</text>
        </box>
      ))}
    </box>
  );
}

function Action({ label, active, onPress }) {
  return (
    <box className={active ? "action active" : "action"} onClick={onPress} tabIndex={0} role="button" style={{ paddingLeft: 8, paddingRight: 8 }}>
      <text>{label}</text>
    </box>
  );
}

function Actions({ id, liked, onLike }) {
  const [copied, setCopied] = useState(false);
  const like = useCallback(() => onLike(id), [id, onLike]);
  const copy = useCallback(() => setCopied(true), []);
  return (
    <box className="actions" style={{ flexDirection: "row", gap: 4, marginTop: 6 }}>
      <Action label={liked ? "Liked" : "Like"} active={liked} onPress={like} />
      <Action label={copied ? "Copied" : "Copy"} active={copied} onPress={copy} />
      <Action label="Retry" active={false} onPress={copy} />
    </box>
  );
}

const Message = memo(function Message({ message, onLike }) {
  const ref = useRef(null);
  return (
    <box ref={ref} className="message" testId={"message-" + message.id} style={{ padding: 12, gap: 4 }}>
      <Header author={message.author} time={message.time} />
      <box className="body">
        {message.paragraphs.map((text, index) => (
          <Paragraph key={index} text={text} />
        ))}
        <Code lines={message.code} />
      </box>
      <Actions id={message.id} liked={message.liked} onLike={onLike} />
    </box>
  );
});

/** What the benchmark drives: `append` adds text to the last message, as a streamed reply does. */
export const controls = { append: null, effects: 0 };

export function Transcript({ initial }) {
  const [messages, setMessages] = useState(initial);
  const onLike = useCallback((id) => {
    setMessages((list) => list.map((message) => (message.id === id ? { ...message, liked: !message.liked } : message)));
  }, []);
  useEffect(() => {
    controls.effects++;
    controls.append = (chunk) => {
      setMessages((list) => {
        const next = list.slice();
        const last = next[next.length - 1];
        const paragraphs = last.paragraphs.slice();
        paragraphs[paragraphs.length - 1] += chunk;
        next[next.length - 1] = { ...last, paragraphs };
        return next;
      });
    };
    return () => {
      controls.append = null;
    };
  }, []);
  return (
    <box className="transcript" style={{ flexDirection: "column" }}>
      {messages.map((message) => (
        <Message key={message.id} message={message} onLike={onLike} />
      ))}
    </box>
  );
}
