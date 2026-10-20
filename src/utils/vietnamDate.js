// DATEONLY comparisons must use the calendar day in Vietnam, not the server's UTC/local day.
const vietnamToday = (now = new Date()) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(now);
module.exports = { vietnamToday };
