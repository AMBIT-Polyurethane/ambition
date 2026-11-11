/**
 * "How To Use A.I." — short walkthrough videos of the AMBIT Intelligence app, for AMBIT employees only.
 * The videos live in the private "academy" storage bucket under how-to/<slug>.mp4 (admins upload or replace
 * them on each video's page); the covers (<slug>.jpg) and first frames (<slug>-poster.jpg) are in public/howto/. chapters: where each step starts (seconds).
 * roles: the job roles a video is meant for (shown first under "For you").
 */
export type HowToVideo = {
  n: number;
  slug: string;
  title: string;
  who: string;
  roles: string[];
  blurb: string;
  seconds: number;
  chapters: { t: number; label: string }[];
};

export const HOWTO_FOLDER = "how-to";
export const howtoPath = (slug: string) => `${HOWTO_FOLDER}/${slug}.mp4`;
/** The video's first frame (its title card), shown in the player before it starts. */
export const howtoPoster = (slug: string) => `/howto/${slug}-poster.jpg`;
/** The cover on the video list (title plus a screen from the video). */
export const howtoThumb = (slug: string) => `/howto/${slug}.jpg`;
export const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export const HOWTO: HowToVideo[] = [
  {
    "n": 1,
    "slug": "loads-and-duplicates",
    "title": "Receiving: Loads and Duplicate Reports",
    "who": "Warehouse managers and admins",
    "roles": [
      "warehouse",
      "admin"
    ],
    "blurb": "Shuttle loads vs. real duplicate reports, the new same-BOL warning, and how to cancel or fix a duplicate.",
    "seconds": 165,
    "chapters": [
      {
        "t": 3.6,
        "label": "What this covers"
      },
      {
        "t": 13.2,
        "label": "Shuttle loads"
      },
      {
        "t": 38.0,
        "label": "A real duplicate"
      },
      {
        "t": 56.2,
        "label": "What went wrong"
      },
      {
        "t": 70.5,
        "label": "New: same-BOL check"
      },
      {
        "t": 78.2,
        "label": "The yellow box"
      },
      {
        "t": 88.4,
        "label": "Same truck?"
      },
      {
        "t": 92.2,
        "label": "A new load?"
      },
      {
        "t": 102.3,
        "label": "Approvers"
      },
      {
        "t": 113.9,
        "label": "Cancel a duplicate"
      },
      {
        "t": 124.7,
        "label": "Already approved?"
      },
      {
        "t": 148.3,
        "label": "Remember"
      }
    ]
  },
  {
    "n": 2,
    "slug": "receive-inventory",
    "title": "How to Receive Inventory",
    "who": "Warehouse managers",
    "roles": [
      "warehouse",
      "admin"
    ],
    "blurb": "Snap the BOL, check every line, send it for approval, and see it land in stock.",
    "seconds": 123,
    "chapters": [
      {
        "t": 3.6,
        "label": "Open Inventory"
      },
      {
        "t": 9.3,
        "label": "Tap Receiving"
      },
      {
        "t": 22.0,
        "label": "Snap the BOL"
      },
      {
        "t": 27.0,
        "label": "The app reads it"
      },
      {
        "t": 40.0,
        "label": "Check the top"
      },
      {
        "t": 42.6,
        "label": "Check every line"
      },
      {
        "t": 50.9,
        "label": "Short or damaged?"
      },
      {
        "t": 64.9,
        "label": "Lines marked Check"
      },
      {
        "t": 73.2,
        "label": "Send for approval"
      },
      {
        "t": 77.5,
        "label": "Waiting for an admin"
      },
      {
        "t": 83.6,
        "label": "Admins: approve it"
      },
      {
        "t": 95.5,
        "label": "It's in stock"
      },
      {
        "t": 102.4,
        "label": "Two rules"
      }
    ]
  },
  {
    "n": 3,
    "slug": "see-stock",
    "title": "How to See What's in Stock",
    "who": "Warehouse managers, CRMs and sales reps",
    "roles": [
      "warehouse",
      "crm",
      "sales_rep",
      "admin"
    ],
    "blurb": "In stock, reserved and available, searching and filtering, and updating an item.",
    "seconds": 90,
    "chapters": [
      {
        "t": 3.6,
        "label": "Open Inventory"
      },
      {
        "t": 9.4,
        "label": "The Dashboard"
      },
      {
        "t": 15.5,
        "label": "Tap Stock"
      },
      {
        "t": 18.5,
        "label": "Your location"
      },
      {
        "t": 29.6,
        "label": "Three numbers"
      },
      {
        "t": 39.2,
        "label": "Search"
      },
      {
        "t": 44.1,
        "label": "Pick a group"
      },
      {
        "t": 48.7,
        "label": "Reorder and Reserved"
      },
      {
        "t": 55.7,
        "label": "Update an item"
      },
      {
        "t": 69.2,
        "label": "Sales reps: the order screen"
      },
      {
        "t": 80.9,
        "label": "Always in sync"
      }
    ]
  },
  {
    "n": 4,
    "slug": "enter-an-order",
    "title": "How to Enter an Order",
    "who": "Sales reps and CRMs",
    "roles": [
      "sales_rep",
      "crm",
      "admin"
    ],
    "blurb": "Pick the location and customer, add items, the required sales rep, delivery, approval and send.",
    "seconds": 101,
    "chapters": [
      {
        "t": 3.6,
        "label": "Tap Order"
      },
      {
        "t": 7.8,
        "label": "Pick the location"
      },
      {
        "t": 16.0,
        "label": "Pick the customer"
      },
      {
        "t": 25.0,
        "label": "Find the items"
      },
      {
        "t": 33.5,
        "label": "Add and set quantities"
      },
      {
        "t": 38.4,
        "label": "Keep adding"
      },
      {
        "t": 44.0,
        "label": "Tap Review"
      },
      {
        "t": 46.5,
        "label": "Sales rep: required"
      },
      {
        "t": 60.3,
        "label": "Save it for next time"
      },
      {
        "t": 66.0,
        "label": "Delivery and PO"
      },
      {
        "t": 73.7,
        "label": "Notes"
      },
      {
        "t": 78.3,
        "label": "Customer approval"
      },
      {
        "t": 87.0,
        "label": "Send it"
      },
      {
        "t": 93.0,
        "label": "Follow it"
      }
    ]
  },
  {
    "n": 5,
    "slug": "close-out-an-order",
    "title": "How to Close Out an Order",
    "who": "Warehouse managers",
    "roles": [
      "warehouse",
      "admin"
    ],
    "blurb": "Find today's order, check payment alerts, snap the signed BOL and mark it picked up or delivered.",
    "seconds": 57,
    "chapters": [
      {
        "t": 3.6,
        "label": "Open the Order desk"
      },
      {
        "t": 11.2,
        "label": "Find the order"
      },
      {
        "t": 19.7,
        "label": "Check what's loading"
      },
      {
        "t": 25.5,
        "label": "Watch for payment alerts"
      },
      {
        "t": 36.0,
        "label": "Snap the signed BOL"
      },
      {
        "t": 41.8,
        "label": "Mark it done"
      },
      {
        "t": 47.0,
        "label": "Done"
      }
    ]
  },
  {
    "n": 6,
    "slug": "order-desk",
    "title": "Order Desk: Sales Order #, Prices and Scheduling",
    "who": "CRMs",
    "roles": [
      "crm",
      "admin"
    ],
    "blurb": "Sales Order and Invoice numbers, item prices, credit release, scheduling, and fixing the sales rep.",
    "seconds": 86,
    "chapters": [
      {
        "t": 3.6,
        "label": "The Order desk"
      },
      {
        "t": 15.5,
        "label": "Orders waiting on you"
      },
      {
        "t": 20.5,
        "label": "Check the order"
      },
      {
        "t": 24.3,
        "label": "Sales Order # and Invoice #"
      },
      {
        "t": 28.7,
        "label": "Prices from the invoice"
      },
      {
        "t": 42.8,
        "label": "Save"
      },
      {
        "t": 47.0,
        "label": "Accounting releases it"
      },
      {
        "t": 57.2,
        "label": "Set the date"
      },
      {
        "t": 67.4,
        "label": "Scheduled"
      },
      {
        "t": 75.6,
        "label": "Wrong sales rep?"
      }
    ]
  },
  {
    "n": 7,
    "slug": "transfers",
    "title": "How to Transfer Stock to Another Location",
    "who": "Warehouse managers",
    "roles": [
      "warehouse",
      "admin"
    ],
    "blurb": "Send stock to another AMBIT location and receive it at the other end.",
    "seconds": 56,
    "chapters": [
      {
        "t": 3.6,
        "label": "Open Transfers"
      },
      {
        "t": 9.1,
        "label": "Send stock"
      },
      {
        "t": 11.1,
        "label": "Where it's going"
      },
      {
        "t": 18.0,
        "label": "What's going"
      },
      {
        "t": 26.3,
        "label": "Send it"
      },
      {
        "t": 33.0,
        "label": "On the road"
      },
      {
        "t": 36.3,
        "label": "Receiving end"
      },
      {
        "t": 42.4,
        "label": "Check and send"
      },
      {
        "t": 48.6,
        "label": "Done"
      }
    ]
  }
];

export const howtoBySlug = (slug: string) => HOWTO.find((v) => v.slug === slug) ?? null;
