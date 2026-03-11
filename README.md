# HubSpot → YouCanBookMe Redirect Service

This project provides a lightweight redirect service that retrieves data from HubSpot and Airtable, constructs a YouCanBookMe booking URL with prefilled parameters, and redirects the user to the booking page.

It is designed to run on Netlify using a static frontend (`index.html`) and a Netlify Serverless Function.

---

# Overview

When a user visits the site with a `deal_id` and `ycbmUrl`, the application:

1. Reads the `deal_id` and `ycbmUrl` from the URL.
2. Calls a Netlify serverless function.
3. The function retrieves the HubSpot Deal and associated Contact/Company.
4. It looks up the HubSpot owner inside Airtable.
5. A payload is constructed using deal, contact, company, and owner data.
6. The payload is appended to the YouCanBookMe URL as query parameters.
7. The user is redirected to the final calendar booking page.

---

# Architecture

Browser
→ Static Page (`index.html`)
→ Netlify Function (`redirect.js`)
→ HubSpot API
→ Airtable API
→ Build Calendar URL
→ Redirect User

---

# Project Structure

```
/
├── index.html
└── netlify
    └── functions
        └── redirect.js
```

---

# Requirements

Accounts and credentials required:

- HubSpot Private App Access Token
- Airtable Personal Access Token
- Airtable Base ID
- Airtable Table ID
- Netlify deployment

---

# Environment Variables

Configure the following variables in Netlify:

```
HUBSPOT_ACCESS_TOKEN=your_hubspot_private_app_token
AIRTABLE_API_KEY=your_airtable_access_token
AIRTABLE_BASE_ID=your_airtable_base_id
AIRTABLE_TABLE=your_airtable_table_id
```

These credentials are used only in the serverless function and are never exposed to the browser.

---

# Usage

Base URL format:

```
https://YOUR_NETLIFY_SITE.netlify.app/?deal_id=DEAL_ID&ycbmUrl=ENCODED_CALENDAR_URL
```

Example:

```
https://YOUR_NETLIFY_SITE.netlify.app/?deal_id=123456789&ycbmUrl=https%3A%2F%2Fmclainspaintinginc-inspect.youcanbook.me%2F
```

Parameters:

| Parameter | Description                   |
| --------- | ----------------------------- |
| deal_id   | HubSpot Deal ID               |
| ycbmUrl   | Base YouCanBookMe booking URL |

---

# Data Flow

Step 1 — Retrieve HubSpot Deal

The function retrieves the deal and associated contact and company.

HubSpot Endpoint:

```
/crm/v3/objects/deals/{deal_id}
```

Associations requested:

- contacts
- companies

---

Step 2 — Retrieve Contact and Company

The primary associated contact and company are fetched for additional information such as:

- Name
- Email
- Phone
- Address

---

Step 3 — Lookup Owner in Airtable

The HubSpot owner ID (`hubspot_owner_id`) is used to query Airtable.

Filter formula:

```
{HS User ID} = hubspot_owner_id
```

Returned fields typically include:

- Name
- Work Email
- Phone Number

---

Step 4 — Construct Booking Payload

The payload combines information from:

- HubSpot Deal
- HubSpot Contact
- HubSpot Company
- Airtable Owner

Examples of fields included:

- jobFirstName
- jobLastName
- jobEmail
