export type DateTimeInputType = "date" | "time" | "datetime-local";

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/;
const TIME = /(\d{2}):(\d{2})/;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function localParts(date: Date) {
  return {
    day: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
  };
}

export function toInputValue(type: DateTimeInputType, value: string): string {
  if (value === "") return "";
  if (type === "time") {
    if (!value.includes("T")) {
      const match = TIME.exec(value);
      return match ? `${match[1]}:${match[2]}` : "";
    }
  }
  if (DATE_ONLY.test(value))
    return type === "datetime-local"
      ? `${value}T00:00`
      : type === "date"
        ? value
        : "";
  if (LOCAL_DATE_TIME.test(value)) {
    if (type === "date") return value.slice(0, 10);
    if (type === "time") return value.slice(11, 16);
    return value.slice(0, 16);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const { day, time } = localParts(date);
  if (type === "date") return day;
  if (type === "time") return time;
  return `${day}T${time}`;
}
