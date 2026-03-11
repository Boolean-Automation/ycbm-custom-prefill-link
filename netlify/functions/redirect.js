let cachedDealProperties = null;

export async function handler(event) {
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

  const headers = {
    Authorization: `Bearer ${HUBSPOT_ACCESS_TOKEN}`,
    "Content-Type": "application/json",
  };

  const ifempty = (...vals) => vals.find((v) => v != null && v !== "") || "";

  const formatPhone = (phone) => {
    if (!phone) return "";
    const digits = phone.replace(/\D/g, "");
    if (digits.startsWith("1") && digits.length >= 11)
      return `+${digits.slice(0, 11)}`;
    if (digits.length === 10) return `+1${digits}`;
    return phone;
  };

  try {
    //
    // CACHE HUBSPOT PROPERTY LIST
    //
    if (!cachedDealProperties) {
      const propResp = await fetch(
        "https://api.hubapi.com/crm/v3/properties/deals?archived=false",
        { headers },
      );

      const propData = await propResp.json();
      cachedDealProperties = propData.results.map((p) => p.name).join(",");
    }

    //
    // GET DEAL
    //
    const dealResp = await fetch(
      `https://api.hubapi.com/crm/v3/objects/deals/${deal_id}?properties=${cachedDealProperties}&associations=contacts,companies`,
      { headers },
    );

    const dealData = await dealResp.json();
    const dealProps = dealData?.properties || {};

    const contactId =
      dealData?.associations?.contacts?.results?.[0]?.id ?? null;
    const companyId =
      dealData?.associations?.companies?.results?.[0]?.id ?? null;

    //
    // PARALLEL FETCH CONTACT + COMPANY + OWNER
    //
    const requests = [];

    if (contactId) {
      requests.push(
        fetch(
          `https://api.hubapi.com/crm/v3/objects/contacts/${contactId}?properties=firstname,lastname,email,phone,address,city,state,zip,mobilephone`,
          { headers },
        ).then((r) => r.json()),
      );
    } else requests.push(Promise.resolve(null));

    if (companyId) {
      requests.push(
        fetch(
          `https://api.hubapi.com/crm/v3/objects/companies/${companyId}?properties=name`,
          { headers },
        ).then((r) => r.json()),
      );
    } else requests.push(Promise.resolve(null));

    const ownerPromise = fetch(
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE}?filterByFormula={HS User ID}='${dealProps.hubspot_owner_id}'`,
      { headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` } },
    ).then((r) => r.json());

    requests.push(ownerPromise);

    const [contactDetails, companyDetails, airtableData] =
      await Promise.all(requests);

    const contact = contactDetails?.properties || {};
    const company = companyDetails?.properties || {};
    const owner = airtableData?.records?.[0]?.fields || {};

    //
    // FIELD RESOLUTION MAP
    //
    const resolver = {
      dealId: () => dealData.id,

      company: () => ifempty(dealProps.company_name, company.name),

      team: () => owner["Name"],

      teamPhone: () => formatPhone(owner["Phone Number"]),

      appointmentType: () =>
        ifempty(
          dealProps.appointment_type,
          dealProps.paintscout_quote_type_label,
        ),

      projectType: () => dealProps.project_type,

      source: () =>
        ifempty(
          dealProps.primary_marketing_source,
          dealProps.source,
          dealProps.multi_source_attribution,
        ),

      jobDescription: () => dealProps.description,

      identifier: () => dealProps.job_identifier,

      projectTimeline: () => dealProps.job_timeline_notes,

      previousCustomer: () => dealProps.previous_customer,

      appointmentScheduledBy: () => dealProps.scheduled_by,

      projectTag: () => dealProps.tags,

      houseYear: () => dealProps.house_built_before_1978,

      referredBy: () => dealProps.referral_name,

      jobFirstName: () =>
        ifempty(dealProps.job_contact_first_name, contact.firstname),

      jobLastName: () =>
        ifempty(dealProps.job_contact_last_name, contact.lastname),

      jobEmail: () => ifempty(dealProps.job_contact_email, contact.email),

      jobPhone: () =>
        formatPhone(
          ifempty(
            dealProps.job_contact_phone,
            contact.mobilephone,
            contact.phone,
          ),
        ),

      jobStreet: () =>
        ifempty(
          dealProps.job_site_street_address,
          contact.address,
          dealProps.billing_street_address,
        ),

      jobCity: () =>
        ifempty(dealProps.job_site_city, contact.city, dealProps.billing_city),

      jobState: () =>
        ifempty(
          dealProps.job_site_state,
          contact.state,
          dealProps.billing_state,
        ),

      jobPostal: () =>
        ifempty(
          dealProps.job_site_postal_code,
          contact.zip,
          dealProps.billing_postal_code,
        ),

      billingFirstName: () =>
        ifempty(
          dealProps.billing_contact_first_name,
          contact.firstname,
          dealProps.job_contact_first_name,
        ),

      billingLastName: () =>
        ifempty(
          dealProps.billing_contact_last_name,
          contact.lastname,
          dealProps.job_contact_last_name,
        ),

      billingEmail: () =>
        ifempty(
          dealProps.billing_contact_email,
          contact.email,
          dealProps.job_contact_email,
        ),

      billingPhone: () =>
        formatPhone(
          ifempty(
            dealProps.billing_contact_phone,
            contact.mobilephone,
            contact.phone,
            dealProps.job_contact_phone,
          ),
        ),

      billingStreet: () =>
        ifempty(
          dealProps.billing_street_address,
          dealProps.job_site_street_address,
          contact.address,
        ),

      billingCity: () =>
        ifempty(dealProps.billing_city, dealProps.job_site_city, contact.city),

      billingState: () =>
        ifempty(
          dealProps.billing_state,
          dealProps.job_site_state,
          contact.state,
        ),

      billingPostal: () =>
        ifempty(
          dealProps.billing_postal_code,
          dealProps.job_site_postal_code,
          contact.zip,
        ),
    };

    //
    // BUILD PAYLOAD
    //
    const payload = {};

    for (const field of Object.keys(shortCodes)) {
      payload[field] = resolver[field]?.() || dealProps[field] || "";
    }

    //
    // APPLY SHORTCODES
    //
    const urlPayload = {};

    for (const [field, shortcode] of Object.entries(shortCodes)) {
      urlPayload[shortcode] = payload[field] || "";
    }

    const location = `${ycbmUrl}?${new URLSearchParams(urlPayload)}`;

    console.log("Redirect:", location);

    return {
      statusCode: 200,
      headers: { "Access-Control-Allow-Origin": "*" },
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
