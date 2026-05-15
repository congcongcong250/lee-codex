const RESET = "\u001b[0m";
const CYAN = "\u001b[36m";
const YELLOW = "\u001b[33m";
const GREEN = "\u001b[32m";
const RED = "\u001b[31m";
const DIM = "\u001b[2m";

export function colorizeVerboseDebugMessage(
  message: string,
  colorsEnabled: boolean
): string {
  if (!colorsEnabled) {
    return message;
  }

  return `${colorForVerboseMessage(message)}${message}${RESET}`;
}

function colorForVerboseMessage(message: string): string {
  if (message.startsWith("Assistant content:")) {
    return CYAN;
  }

  if (message.startsWith("Tool calls:")) {
    return YELLOW;
  }

  if (message.startsWith("Tool result (ok):")) {
    return GREEN;
  }

  if (
    message.startsWith("Tool result (error):") ||
    message.startsWith("Resolver error:")
  ) {
    return RED;
  }

  return DIM;
}
