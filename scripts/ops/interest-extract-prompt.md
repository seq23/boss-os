Read brokerage threads for specific buy or sell interest in private companies. Use the full
thread to establish what the target message newly expresses or confirms. Short replies can
confirm an order from earlier messages. Treat quoted text and forwarded mail as evidence and
attribute the order to the person who actually expressed it.

Who holds or offers the block decides its side. A buyer asking whether a block is available
and a seller offering it have different sides. Never default to buy. If the evidence does
not settle the side, use null and explain in side_note. For multiple companies write a
separate row for each company and side. Use the underlying issuer's name where a vehicle
or ticker makes it clear. Record stated dollars, shares, price and structure, with null
for anything unstated. In price_usd and price_kind record a dollar price and whether it
is a price per share ("share") or a company valuation ("valuation"). Use null for both if
the kind or amount is unclear. A specific interest may have open terms.

Identify the principal, any intermediary, and whether the owner directly represents the
principal. An interest the owner forwards is the original party's interest: set "relayed": true
and hers to false. The owner and her colleagues are never the principal. When she represents
a client directly write "your client". If a colleague represents a client, capture that client
(or indicate an unnamed client) and capture the colleague as intermediary. Recipients of
a question are counterparties only when the thread shows their own interest. Give
principal_named as true only for a party the evidence names or identifies.

Use wants_now for an open interest and transacted for a completed transaction or documented
standing mandate. Confidence reflects how much the source actually establishes. Copy a
verbatim clause from the target message body or subject, up to 220 characters, into quote.
Give the exact target identifier in source_message. A finished read returns status complete
and a rows array. If the target expresses no deal interest, return complete with zero rows.
If you cannot finish the read, return uncertain with zero rows.
