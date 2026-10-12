/**
 * Rev-IQ site forms: one shared Formspree endpoint powers every form on the site:
 * the homepage Contact form and every gated PDF download form on the article pages.
 *
 * SETUP (one-time, ~5 minutes):
 *   1. Go to https://formspree.io and sign up free using joel.smith@rev-iq.ai
 *   2. Create one new form (call it "Rev-IQ site forms")
 *   3. Formspree emails you a confirmation link the first time; click it to activate
 *   4. Copy your form's endpoint ID from the Formspree dashboard
 *   5. Paste it below, replacing YOUR_FORM_ID
 *
 * Every submission (contact messages and PDF download requests) will land in the
 * joel.smith@rev-iq.ai inbox. Each one arrives with a distinct subject line
 * ("New Contact Message" vs "Download Request: <asset name>") and a "form_type" /
 * "asset" field in the message body, so they're easy to tell apart at a glance.
 */
const FORMSPREE_ENDPOINT = "https://formspree.io/f/mjgnyqgj";

function triggerDownload(href) {
  const a = document.createElement("a");
  a.href = href;
  a.setAttribute("download", "");
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function setFormState(form, state) {
  form.querySelectorAll("[data-state]").forEach((el) => {
    el.hidden = el.getAttribute("data-state") !== state;
  });
}

const SKILL_PLATFORMS = { claude: "Claude", chatgpt: "ChatGPT", perplexity: "Perplexity" };

function skillFiles(form) {
  const checked = form.querySelector("input[name=platform]:checked");
  const platform = checked ? checked.value : "claude";
  return {
    platform,
    label: SKILL_PLATFORMS[platform] || platform,
    zip: "/assets/skills/" + platform + "/" + form.dataset.skill + ".zip",
    guide: "/assets/skills/rev-iq-ai-skills-install-guide-" + platform + ".pdf",
  };
}

async function submitRevIqForm(form) {
  const data = new FormData(form);
  let skill = null;
  if (form.dataset.skill) {
    skill = skillFiles(form);
    const name = form.dataset.skillName || form.dataset.skill;
    data.set("asset", name + " (" + skill.label + ")");
    data.set("_subject", "Skill Download: " + name + " for " + skill.label + " | rev-iq.ai");
  }
  const submitBtn = form.querySelector("button[type=submit]");
  const originalLabel = submitBtn ? submitBtn.textContent : "";
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = "Sending…";
  }
  try {
    const response = await fetch(FORMSPREE_ENDPOINT, {
      method: "POST",
      headers: { Accept: "application/json" },
      body: data,
    });
    if (response.ok) {
      setFormState(form, "success");
      if (skill) {
        form.querySelectorAll("[data-skill-zip]").forEach((a) => { a.href = skill.zip; });
        form.querySelectorAll("[data-skill-guide]").forEach((a) => { a.href = skill.guide; });
        form.querySelectorAll("[data-skill-platform]").forEach((el) => { el.textContent = skill.label; });
        if (typeof gtag === "function") {
          gtag("event", "skill_download", { skill_name: form.dataset.skill, platform: skill.platform });
        }
        triggerDownload(skill.zip);
      }
      const pdf = form.dataset.pdf;
      if (pdf) triggerDownload(pdf);
      form.reset();
    } else {
      setFormState(form, "error");
    }
  } catch (err) {
    setFormState(form, "error");
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = originalLabel;
    }
  }
}

document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll("form[data-rev-iq-form]").forEach((form) => {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      submitRevIqForm(form);
    });
  });
});
