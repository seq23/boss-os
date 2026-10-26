/**
 * The real shape of a venue's answer that Simone told her was "booked" (26 Oct 2026), anonymised:
 * three times to choose from, a fee per show, a dress code, a no-show/late-cancellation charge, a
 * request for a phone number and a time preference, a sign-off, a postal block, and the quoted
 * thread below it (Outlook style) carrying Simone's own "anything you need to confirm".
 */
export const VENUE = "reservations@club.example.test";
export const VENUE_MESSAGE_ID = "<AB12CD34EF@mail.club.example.test>";
export const OPTIONS_REPLY = [
  "Hello,",
  "",
  "We can accommodate your party of 2 on Thursday, October 29 at 6:30pm or 9pm for either live performance, or at 11pm for the DJ set. Please note there is a $75/person performance fee for the 6:30 show; for the 9:00 show, $100/person. Our performance calendar can be found at club.example.test.",
  "",
  "We enforce an elegant dress code, and require 24 hours notice for cancellations. In the event of a no-show or cancellation within 24 hours of your reservation time, we charge the performance fee (x) party size + tax.",
  "",
  "Should you wish to proceed with reserving, please provide a telephone number, along with your preference of the offered times.",
  "",
  "Warmly,",
  "",
  "Jamie Rivera",
  "Reservation Specialist of The Example Club",
  "",
  "THE EXAMPLE HOTEL",
  "1 Example Avenue",
  "Springfield",
  "",
  "",
  "From: Simone <simone@sequoiataylor.com>",
  "Date: Monday, October 26, 2026 at 3:46 PM",
  `To: The Example Club <${VENUE}>`,
  "Subject: Reservation request: Thursday, October 29, party of 2",
  "",
  "Hello,",
  "",
  "I'm writing on behalf of Sequoia Taylor to request a table for two at The Example Club on Thursday, October 29, any time after 8:00 pm. Please let me know what's available and anything you need to confirm.",
  "",
  "Thank you,",
  "Simone",
  "Assistant to Sequoia Taylor",
].join("\r\n");
export const PHONE = "212-555-0100";
