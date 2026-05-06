// Exit-code scheme. Commander already uses 2 for its own parse/usage
// errors; we line up our validation rejections at the same level so a
// shell script can treat "user gave bad input" uniformly.
//
//   0  success
//   1  runtime failure (file write, network unreachable, malformed response)
//   2  invalid input (commander parse error or our validation error)
//   3  compat below floor (CLI < server's minClientVersion)

export const EXIT_SUCCESS = 0;
export const EXIT_RUNTIME_FAILURE = 1;
export const EXIT_INVALID_INPUT = 2;
export const EXIT_COMPAT_BELOW_FLOOR = 3;
