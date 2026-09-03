// Events and programs for the "Events and programs you took part in" step
// of the letter intake form (letter/app.js). Data from the Claude Design
// export (intake-events.js), unchanged: most recent year first; within a year
// regular programs, then months December → January.
// Shape per year: { y, programs: [[name, detail]], months: [[monthName, [eventName, ...]]] }
// Ids are positional (2026-p0, 2026-m0-1 …) and are stored in drafts and on
// the Letters of Support board — append new events at the END of a month or
// program list, never reorder, or old answers will point at the wrong event.
// Translations of the names live in letter/events-i18n.js, keyed by id.
window.QARAVAN_EVENTS = [
{ y: 2026, programs: [
  ["Support Group with Gina / Mental Health Support Group", "online, about twice a month"],
  ["Peer Support Group with Simon", "online, monthly"],
  ["Rainbow Connections", "monthly, January–April"],
  ["Community Help Desk (one-on-one questions hour)", "March, April, July, September"],
  ["Art Class with Lilu (aquarelle)", "March, June, September"],
  ["Girls' Gathering with Alyona", "May, July, September"]
], months: [
  ["October", ["Talk & discussion: A Normal Boy — How I Was Gay in Russia"]],
  ["September", ["Bull Hill hike, Cold Spring", "Movie Night: Paris Is Burning", "Bike Ride & Picnic in Prospect Park", "Midtown walking tour"]],
  ["August", ["Pasta-making master class", "LGBTQ+ history walking tour, Greenwich Village", "Movie Night: United in Anger — A History of ACT UP", "Beach Day: Rockaway (Riis Beach)", "Bear Mountain hike & swim", "Asylum Interview Experience: Q&A"]],
  ["July", ["Greenwood Lake hike", "Volunteer Thank You Day: wine tasting & concert"]],
  ["June", ["Hike in Harriman State Park", "Dyke March"]],
  ["May", ["Pride poster making", "Brighton Beach Pride 2026"]],
  ["April", ["Volunteer Appreciation Day", "Disco Fever \"Crazy Spring\" party", "Screening & Q&A: Mr Nobody Against Putin"]],
  ["March", ["Women's History Month gala concert «Хорошие девчата»", "Girls karaoke night"]],
  ["February", ["Taxes & reporting webinar", "Qaravan Valentine's Party", "Higher Education in the US: Master's & PhD"]],
  ["January", ["Book discussion «Лето в пионерском галстуке» with the authors"]]
]},
{ y: 2025, programs: [
  ["Mental Health Support Group with Gina", "twice a month"],
  ["Peer Support Group with Simon", "monthly"],
  ["Drag Race Watching Party at Coney Island", "Fridays, January–April"],
  ["Art Workshop «Мастерская вдохновения» (painting / aquarelle)", "monthly, January–July"],
  ["Qaravan Connects community meeting at CBST", "monthly, May–October"],
  ["Community meetings on practical topics (BCPC series)", "roughly monthly; topics listed by month"],
  ["Community Help Desk", "October, December"],
  ["Rainbow Connections", "June, September, October, November"],
  ["Hike / Поход на природу", "August, October, November"],
  ["Beach volleyball in Manhattan", "July, August"]
], months: [
  ["December", ["Holiday Party (21+)", "Taxes & reporting meeting"]],
  ["November", ["Community meeting: medicine in the US Q&A", "Thanksgiving Day gathering", "The Nutcracker ballet outing"]],
  ["October", ["Job Ready: resumes & interviews for the trans community", "Community meeting: what is CORE?", "Community meeting: NYC anti-discrimination initiatives"]],
  ["September", ["Community meeting: education in the USA"]],
  ["August", ["Family picnic for parents and kids", "Picnic in Central Park"]],
  ["June", ["Gayridge Pride: Keep South Brooklyn Queer", "Community meeting: healthcare Q&A", "NYC Pride March"]],
  ["May", ["Spring picnic & sign-making", "Community meeting: Pride sign making", "Brighton Beach Pride 2025", "Resource Fair at Brighton Beach Library", "Community meeting: intro to NYC Human Rights Law", "Pride Drag Brunch in Coney Island"]],
  ["April", ["Live music evening with Bravo", "Online meeting with immigration lawyer Natalia Gavlin", "Unhinged Tuesday with Svetlana Stoli", "Volunteer training: stress & burnout", "Meeting: Brighton Beach Pride — why it matters", "Spring picnic", "Self-defense class with the NYPD LGBT+ unit"]],
  ["March", ["Ice skating in Central Park", "Screening & discussion: Queendom", "Minelli concert outing", "Exhibition \"Women's Queer Voices\"", "Exhibition \"Life in Prison\" (prints by Asya, with Memorial)", "Bubble show for kids", "Online webinar: tax & employment issues for immigrants", "Community meeting: DEI certification for LGBTQ+ entrepreneurs", "Collaborative queerzine for Brighton Beach Pride", "Theatre: \"Sorry, Wrong Number\""]],
  ["February", ["Community meeting: resumes & interviews", "Community meeting: dealing with stress / mental-health resources", "Evening of letters to political prisoners", "Screening: Crossing", "Drag Brunch: Love", "Taxes & reporting meeting", "Online meeting for trans community members", "Community meeting: health insurance for LGBTQ+ immigrants"]],
  ["January", ["Community meeting: how to create a successful resume", "Ice skating in Central Park", "Play reading «Финист Ясный Сокол»", "Meeting with NYPD LGBTQ+ liaisons", "Carnegie Hall: Bernstein's \"Kaddish\""]]
]},
{ y: 2024, programs: [
  ["Mental Health Support Group with Gina", "twice a month, February–December"],
  ["Peer Support Group with Simon", "monthly, February–December"],
  ["RuPaul's Drag Race viewing party & performance", "Fridays, January–April"],
  ["Regular community meeting / BCPC series", "about twice a month, February–December"],
  ["Pro Se Legal Clinic with SAFE Asylum", "about twice a month, March–November"],
  ["Regional meetups: Fort Lauderdale, Boston, Los Angeles", "Fort Lauderdale monthly Feb–Jul; Boston Feb, Mar, May, Jun; LA Jul, Sep"]
], months: [
  ["December", ["The Nutcracker ballet outing", "Ceramics master class", "The Merchant of Venice theatre outing", "Community meeting: careers in medicine in the US", "Holiday Party / New Year party at VV Bar", "Christmas lights walk, Dyker Heights", "Community meeting with immigration lawyer Natalia Gavlin", "Holiday Drag Brunch", "Painting master class"]],
  ["November", ["Fall picnic & coat distribution", "Letters of Freedom (Письма свободы)", "Trip to Philadelphia", "Ceramics painting master class", "Bubble show for kids", "TGNCNB Job Fair", "Community meeting: elections & US government", "Community meeting: Thanksgiving"]],
  ["October", ["Movie Night: Joker", "Immigration legal clinic volunteer training with SAFE", "National Coming Out Day celebration", "Painting master class: Halloween", "Community meeting: health", "Exhibition & talk: The Crime of Being Gay (North Caucasus)"]],
  ["September", ["Beach Day at Riis Beach", "9/11 Memorial visit", "Clothes drive / giveaway", "Drag Brunch (Maxim's birthday)", "Aquarelle & new friends", "Hike in Highlands State Park Preserve", "Community meeting: anxiety & group meditation"]],
  ["August", ["Brooklyn Museum Caribbean party", "Community meeting: health questions", "Beach Day at Riis Beach", "Movie Night at Bryant Park", "Prideshow at The Sideshow", "BCPC Mini Film Festival"]],
  ["July", ["Pride Continues! Drag Brunch", "Webinar with International Rescue Committee", "Letters of Freedom (letters to political prisoners)", "Coney Island Variety Show: Pride Edition", "Community meeting: small business", "Movie Night at Bryant Park"]],
  ["June", ["Gayridge Pride", "Picnic & painting ahead of Dyke March", "Eastern European Day celebration & family picnic", "Pride walking tour, West Village", "Webinar: tax & employment issues for immigrants (Legal Services NYC)", "Dyke March", "NYC Pride March"]],
  ["May", ["Screening at Coney Island Film Festival: At Home With Strangers", "Picnic / Girls' Night for Lesbian Visibility Week", "Community meeting: mental health with Gina", "Eurovision viewing party", "Creative picnic", "Variety Show at Coney Island", "Pride sign-making at Brighton Beach Library", "8th Brighton Beach Pride, march & afterparty", "Drag Night at Balcon Salon", "Community meeting: post-Pride discussion"]],
  ["April", ["Improvised picnic", "Tribute show to Alla Pugacheva «Женщина, которая поёт»", "Community meeting: health insurance", "Lesbian Visibility picnic + Ginger's Bar"]],
  ["March", ["Community meeting: Q&A with an immigration attorney", "Global Speak Out in solidarity with Russia's LGBT+ community", "Girls' Night: St. Patrick's edition", "Webinar on financial literacy"]],
  ["February", ["Webinar on taxes", "Community meeting: health", "Art Therapy", "Asylum book presentation"]],
  ["January", ["Rainbow Connections kickoff", "Community meeting: Ali Forney Center & shelters", "Girls' Night (Девичник)"]]
]},
{ y: 2023, programs: [], months: [
  ["December", ["Community meeting: NYPD", "New Year Party", "Resume writing workshop"]],
  ["November", ["Clothing drive / giveaway", "Community meeting: sharing experience & lifehacks", "Community meeting: know your labor rights"]],
  ["October", ["Screening: My Affair With Marriage", "NYC Arts and Culture", "NewFest screening", "Visit to Nicholas Roerich Museum", "Rainbow Connections presentation", "Volunteers orientation"]],
  ["September", ["Beach Day", "Community meeting on healthcare", "Girls Night", "Art Therapy community event"]],
  ["August", ["Movie Night at Bryant Park (two evenings, incl. Zoolander)", "Meeting with lawyer Sebastian Maguire", "Music of Curiosities concert: music from Eurasian immigrants", "Mix and Mingle at Brooklyn Community Pride Center", "Visit to the Met with Alena Lipa", "Beach Day"]],
  ["July", ["Yoga on the beach", "RIF Asylum info session on mandamus (online)", "Asylum application workshop (volunteers)", "Drag & live music party", "Info session on CUNY / education"]],
  ["May", ["Brighton Beach Pride (7th)"]]
]},
{ y: 2022, programs: [["Support Group (recurring, NYC / online)", "from March"]], months: [
  ["October", ["The Center's LGBTQ+ Career Fair"]],
  ["September", ["Fundraiser at Anyway Cafe"]],
  ["June", ["Queer Liberation March (Reclaim Pride)", "NYC Pride March", "Her Migrant Hub roundtable on immigrant queer/trans women's health"]],
  ["May", ["LGBTQ+ health & medicine webinar (Ark clinic)", "6th Brighton Beach Pride"]],
  ["April", ["Benefit Concert for LGBTQI+ in Ukraine (BETTY concert)", "HIAS webinar: Ukrainian arrivals / Uniting for Ukraine"]],
  ["March", ["Hands Off Ukraine march and rally", "TPS for Ukraine info & registration"]],
  ["February", ["Valentine's Party with Ellina Graypel", "Immigration attorney Q&A webinar"]]
]},
{ y: 2021, programs: [["Weekly asylum legal clinic with CBST (Zoom)", "weekly"]], months: [
  ["December", ["Holiday Party", "Her Migrant Hub panel: women asylum seekers & refugees"]],
  ["November", ["Skyeng English courses partnership launch", "Panel discussion: Queer Central Asian Activism (with the Oxus Society)"]],
  ["October", ["Tent Partnership for Refugees mentorship program launch"]],
  ["June", ["Queer Liberation March"]],
  ["May", ["Brighton Beach Pride (5th)"]]
]},
{ y: 2020, programs: [["Wednesday legal clinic", "in person until March, then online"], ["COVID-19 emergency financial assistance program", "from March"]], months: [
  ["August", ["Drag Brunch"]],
  ["July", ["Online conference: tenant rights during COVID-19", "Webinar: higher education in the US", "Webinar: where to read American news"]],
  ["June", ["Virtual walking tour: Greenwich Village LGBTQ history"]],
  ["May", ["Brighton Beach Pride 2020 (virtual) «Квиру — мир, миру — квир»", "Screening & Q&A: Welcome to Chechnya"]]
]},
{ y: 2019, programs: [["Weekly Wednesday support meetings with on-site legal help", "weekly"], ["Legal clinic with immigration attorneys", "March, April, then weekly Wednesdays from August"]], months: [
  ["December", ["Working Theater \"Five Boroughs / One City\" Brighton Beach play"]],
  ["June", ["Stonewall 50 exhibition tour, New-York Historical Society"]],
  ["May", ["Brighton Beach Pride 2019"]]
]},
{ y: 2018, programs: [["Weekly Wednesday bilingual meeting / office hours", "weekly"], ["Monthly legal clinic with immigration attorneys", "January, April, October"]], months: [
  ["June", ["Picnic in Central Park", "NYC Pride March (Resistance Contingent)", "Queer Liberation March / Reclaim Pride Coalition"]]
]},
{ y: 2017, programs: [["Welcoming the Stranger program", "from February"], ["Asylum & immigration consultation service", "from February"]], months: [
  ["December", ["Literary evening with Eileen Myles, Masha Gessen and Anna Halberstadt"]],
  ["November", ["Bill and Binny benefit show"]],
  ["October", ["Voices for Chechnya march and rally"]],
  ["June", ["Panel: Queer and Chechen — No Place to Hide", "Chechen refugee resettlement volunteer drive", "NYC Pride March contingent"]],
  ["May", ["First Brighton Beach Pride march and rally"]],
  ["April", ["Protest at the Russian Consulate (Chechnya purge)"]],
  ["January", ["Mount Sinai HIV care presentation to the support group"]]
]},
{ y: 2016, programs: [["CBST \"Meet the Stranger\" cultural-buddy program", "from December"]], months: [
  ["December", ["New Year's Party", "Samovar Nights: readings & knitting"]],
  ["November", ["Movie Night: The Times of Harvey Milk"]],
  ["October", ["Samovar Nights: games", "Poetry from the Underground"]],
  ["September", ["Discovering Ukraine evening «Вечера на хуторе близ Диканьки»"]],
  ["August", ["Tearoom Readings"]],
  ["June", ["Panel with Masha Gessen: Surviving Endangered", "Pride afterparty", "NYC Pride March delegation"]],
  ["May", ["AIDS Walk New York / Odessa Pride solidarity", "Benefit evening", "Post-Soviet Gay Disco Party", "Picnic in Central Park"]],
  ["April", ["Asylum legal workshop"]],
  ["February", ["Tearoom Readings"]],
  ["January", ["Welcoming the Stranger closing ceremony"]]
]},
{ y: 2015, programs: [["Weekly Russian-speaking LGBT support group & asylum/legal office hours", "weekly"]], months: [
  ["December", ["New Year's Party"]],
  ["September", ["Protest against Putin at the UN General Assembly"]],
  ["June", ["Panel: What's the Story with Pride, Russia and Ukraine?", "NYC Pride March"]],
  ["April", ["Screening: Stateless"]]
]},
{ y: 2014, programs: [], months: [
  ["December", ["Holiday Party"]],
  ["July", ["Terrace party"]],
  ["June", ["NYC Comptroller's Pride celebration", "NYC Pride March & afterparty"]],
  ["May", ["AIDS Walk New York"]],
  ["February", ["Times Square protest against Russia's anti-gay laws & Sochi Olympics", "Amnesty International \"Bringing Human Rights Home\" concert", "#CheersToSochi global virtual demonstration", "Night of a Thousand Gowns gala (Imperial Court)"]]
]},
{ y: 2013, programs: [], months: [
  ["December", ["Kiss-in at the Brooklyn IKEA", "Global day of action against IKEA", "Holiday / New Year Party"]],
  ["November", ["Community event at This and That, Brooklyn", "Russia Day at the NYSE protest"]],
  ["October", ["Protest of visiting Moscow officials"]],
  ["September", ["Logo TV Town Hall on Russia", "Metropolitan Opera opening-night picket", "Emergency fundraiser for Alexey Davydov's funeral"]],
  ["August", ["Community town hall"]],
  ["July", ["Protest near the Russian Consulate"]],
  ["June", ["Pre-Pride rooftop party", "NYC Pride March (Sochi boycott theme)"]]
]},
{ y: 2012, programs: [], months: [
  ["November", ["Ali Forney Center benefit at Joe's Pub"]],
  ["June", ["NYC Pride March — first Russian-speaking contingent", "Post-Pride community dinner"]]
]}
];
