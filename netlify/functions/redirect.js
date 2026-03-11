export async function handler(event) {
  const deal_id = event.queryStringParameters?.deal_id;
  const ycbmUrl = event.queryStringParameters?.ycbmUrl;

  if (!deal_id) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Missing deal_id" }),
    };
  }

  if (!ycbmUrl) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Missing ycbmUrl" }),
    };
  }

  const HUBSPOT_ACCESS_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN;
  const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
  const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
  const AIRTABLE_TABLE = process.env.AIRTABLE_TABLE;

  const authHeaders = {
    Authorization: `Bearer ${HUBSPOT_ACCESS_TOKEN}`,
    "Content-Type": "application/json",
  };

  function ifempty(...values) {
    return values.find((v) => v != null && v !== "") || "";
  }

  function formatPhoneForUrl(phone) {
    if (!phone) return phone;

    const digits = phone.replace(/\D/g, "");

    if (digits.startsWith("1") && digits.length >= 11) {
      return `+${digits.slice(0, 11)}`;
    }

    if (digits.length === 10) {
      return `+1${digits}`;
    }

    return phone;
  }

  try {
    //
    // GET DEAL + ASSOCIATIONS
    //
    const dealResp = await fetch(
      `https://api.hubapi.com/crm/v3/objects/deals/${deal_id}?associations=contacts,companies`,
      { headers: authHeaders },
    );

    const dealData = await dealResp.json();

    const dealProps = dealData?.properties || {};

    const contactId =
      dealData?.associations?.contacts?.results?.[0]?.id ?? null;

    const companyId =
      dealData?.associations?.companies?.results?.[0]?.id ?? null;

    //
    // PARALLEL FETCH CONTACT + COMPANY
    //
    const requests = [];

    if (contactId) {
      requests.push(
        fetch(
          `https://api.hubapi.com/crm/v3/objects/contacts/${contactId}?properties=firstname,lastname,email,phone,address,city,state,zip,mobilephone`,
          { headers: authHeaders },
        ).then((r) => r.json()),
      );
    } else {
      requests.push(Promise.resolve(null));
    }

    if (companyId) {
      requests.push(
        fetch(
          `https://api.hubapi.com/crm/v3/objects/companies/${companyId}?properties=name`,
          { headers: authHeaders },
        ).then((r) => r.json()),
      );
    } else {
      requests.push(Promise.resolve(null));
    }

    const [contactDetails, companyDetails] = await Promise.all(requests);

    const contactData = contactDetails?.properties || {};
    const companyData = companyDetails?.properties || {};

    //
    // AIRTABLE OWNER LOOKUP
    //
    const ownerId = dealProps.hubspot_owner_id;

    const airtableResp = await fetch(
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE}?filterByFormula={HS User ID}='${ownerId}'`,
      {
        headers: {
          Authorization: `Bearer ${AIRTABLE_API_KEY}`,
        },
      },
    );

    const airtableData = await airtableResp.json();
    const ownerData = airtableData?.records?.[0]?.fields || {};

    //
    // BUILD PAYLOAD
    //
    const payload = {};

    payload.dealId = dealData.id || "";

    payload.team = ownerData["Name"] || "";
    payload.estimatorEmail = ownerData["Work Email"] || "";
    payload.teamPhone = formatPhoneForUrl(ownerData["Phone Number"] || "");

    payload.appointmentType =
      dealProps.appointment_type || "In-Person Estimate";

    payload.projectType = String(ifempty(dealProps.project_type)).replace(
      /;/g,
      ",",
    );

    payload.jobFirstName = ifempty(
      dealProps.job_contact_first_name,
      contactData.firstname,
    );

    payload.jobLastName = ifempty(
      dealProps.job_contact_last_name,
      contactData.lastname,
    );

    payload.jobEmail = ifempty(dealProps.job_contact_email, contactData.email);

    payload.jobPhone = formatPhoneForUrl(
      ifempty(
        dealProps.job_contact_phone,
        contactData.mobilephone,
        contactData.phone,
      ),
    );

    payload.company = ifempty(dealProps.company_name, companyData.name);

    const encoded = new URLSearchParams(payload).toString();

    const location = `${ycbmUrl}?${encoded}`;

    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({ location }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
}
