export async function handler(event) {
  console.log("Query params:", event.queryStringParameters);

  const deal_id = event.queryStringParameters?.deal_id;
  const ycbmUrl = event.queryStringParameters?.ycbm_url;

  if (!deal_id) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Missing deal_id" }),
    };
  }

  if (!ycbmUrl) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Missing ycbm_url" }),
    };
  }

  const HUBSPOT_ACCESS_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN;
  const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
  const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
  const AIRTABLE_TABLE = process.env.AIRTABLE_TABLE;

  const shortCodes = JSON.parse(process.env.SHORTCODES_JSON || "{}");

  const authHeaders = {
    Authorization: `Bearer ${HUBSPOT_ACCESS_TOKEN}`,
    "Content-Type": "application/json",
  };

  const ifempty = (...values) =>
    values.find((v) => v != null && v !== "") || "";

  const formatPhoneForUrl = (phone) => {
    if (!phone) return "";

    const digits = phone.replace(/\D/g, "");

    if (digits.startsWith("1") && digits.length >= 11) {
      return `+${digits.slice(0, 11)}`;
    }

    if (digits.length === 10) {
      return `+1${digits}`;
    }

    return phone;
  };

  try {
    //
    // GET ALL DEAL PROPERTY DEFINITIONS
    //
    const propResp = await fetch(
      "https://api.hubapi.com/crm/v3/properties/deals?archived=false",
      { headers: authHeaders },
    );

    const propData = await propResp.json();
    const deal_properties = propData.results.map((p) => p.name);
    const propertiesParam = deal_properties.join(",");

    //
    // GET DEAL
    //
    const dealResp = await fetch(
      `https://api.hubapi.com/crm/v3/objects/deals/${deal_id}?properties=${propertiesParam}&associations=contacts,companies`,
      { headers: authHeaders },
    );

    const dealData = await dealResp.json();
    const dealProps = dealData?.properties || {};

    console.log("Deal properties:", dealProps);

    const contactId =
      dealData?.associations?.contacts?.results?.[0]?.id ?? null;

    const companyId =
      dealData?.associations?.companies?.results?.[0]?.id ?? null;

    //
    // FETCH CONTACT + COMPANY
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
    // GET OWNER FROM AIRTABLE
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

    for (const field of Object.keys(shortCodes)) {
      let value = "";

      switch (field) {
        case "dealId":
          value = dealData.id;
          break;

        case "company":
          value = ifempty(dealProps.company_name, companyData.name);
          break;

        case "team":
          value = ownerData["Name"];
          break;

        case "teamPhone":
          value = formatPhoneForUrl(ownerData["Phone Number"]);
          break;

        case "appointmentType":
          value = ifempty(
            dealProps.appointment_type,
            dealProps.paintscout_quote_type_label,
          );
          break;

        case "projectType":
          value = dealProps.project_type;
          break;

        case "source":
          value = ifempty(
            dealProps.primary_marketing_source,
            dealProps.source,
            dealProps.multi_source_attribution,
          );
          break;

        case "jobDescription":
          value = dealProps.description;
          break;

        case "identifier":
          value = dealProps.job_identifier;
          break;

        case "projectTimeline":
          value = dealProps.job_timeline_notes;
          break;

        case "previousCustomer":
          value = dealProps.previous_customer;
          break;

        case "appointmentScheduledBy":
          value = dealProps.scheduled_by;
          break;

        case "projectTag":
          value = dealProps.tags;
          break;

        case "houseYear":
          value = dealProps.house_built_before_1978;
          break;

        case "referredBy":
          value = dealProps.referral_name;
          break;

        //
        // JOB CONTACT
        //
        case "jobFirstName":
          value = ifempty(
            dealProps.job_contact_first_name,
            contactData.firstname,
          );
          break;

        case "jobLastName":
          value = ifempty(
            dealProps.job_contact_last_name,
            contactData.lastname,
          );
          break;

        case "jobEmail":
          value = ifempty(dealProps.job_contact_email, contactData.email);
          break;

        case "jobPhone":
          value = formatPhoneForUrl(
            ifempty(
              dealProps.job_contact_phone,
              contactData.mobilephone,
              contactData.phone,
            ),
          );
          break;

        //
        // JOB ADDRESS
        //
        case "jobStreet":
          value = ifempty(
            dealProps.job_site_street_address,
            contactData.address,
            dealProps.billing_street_address,
          );
          break;

        case "jobCity":
          value = ifempty(
            dealProps.job_site_city,
            contactData.city,
            dealProps.billing_city,
          );
          break;

        case "jobState":
          value = ifempty(
            dealProps.job_site_state,
            contactData.state,
            dealProps.billing_state,
          );
          break;

        case "jobPostal":
          value = ifempty(
            dealProps.job_site_postal_code,
            contactData.zip,
            dealProps.billing_postal_code,
          );
          break;

        //
        // BILLING FALLBACK → JOB
        //
        case "billingFirstName":
          value = ifempty(
            dealProps.billing_contact_first_name,
            contactData.firstname,
            dealProps.job_contact_first_name,
          );
          break;

        case "billingLastName":
          value = ifempty(
            dealProps.billing_contact_last_name,
            contactData.lastname,
            dealProps.job_contact_last_name,
          );
          break;

        case "billingEmail":
          value = ifempty(
            dealProps.billing_contact_email,
            contactData.email,
            dealProps.job_contact_email,
          );
          break;

        case "billingPhone":
          value = formatPhoneForUrl(
            ifempty(
              dealProps.billing_contact_phone,
              contactData.mobilephone,
              contactData.phone,
              dealProps.job_contact_phone,
            ),
          );
          break;

        case "billingStreet":
          value = ifempty(
            dealProps.billing_street_address,
            dealProps.job_site_street_address,
            contactData.address,
          );
          break;

        case "billingCity":
          value = ifempty(
            dealProps.billing_city,
            dealProps.job_site_city,
            contactData.city,
          );
          break;

        case "billingState":
          value = ifempty(
            dealProps.billing_state,
            dealProps.job_site_state,
            contactData.state,
          );
          break;

        case "billingPostal":
          value = ifempty(
            dealProps.billing_postal_code,
            dealProps.job_site_postal_code,
            contactData.zip,
          );
          break;

        default:
          value = dealProps[field];
      }

      payload[field] = value || "";
    }

    console.log("Payload:", payload);

    //
    // APPLY SHORTCODES
    //
    const urlPayload = {};

    for (const [field, shortcode] of Object.entries(shortCodes)) {
      urlPayload[shortcode] = payload[field] || "";
    }

    const encoded = new URLSearchParams(urlPayload).toString();
    const location = `${ycbmUrl}?${encoded}`;

    console.log("Redirecting to:", location);

    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({ location }),
    };
  } catch (err) {
    console.error(err);

    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
}
