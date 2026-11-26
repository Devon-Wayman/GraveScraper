const CEMETERY_FIELD_OPTIONS = {
  ownerTypes: [
    { value: "", label: "Unknown / not recorded" },
    { value: "person", label: "Person" },
    { value: "group", label: "Group / organization" },
    { value: "city", label: "City / local government" },
    { value: "other", label: "Other" }
  ],
  permissionStatuses: [
    { value: "", label: "Not started / not confirmed" },
    { value: "researching", label: "Finding the owner" },
    { value: "requested", label: "Permission requested" },
    { value: "follow-up", label: "Follow-up needed" },
    { value: "granted", label: "Granted" },
    { value: "denied", label: "Denied" },
    { value: "revoked", label: "Revoked" }
  ]
};
const MEMORIAL_FIELD_OPTIONS = {
  cleaningWorkStatuses: [
    { value: "", label: "Automatic — track while history exists" },
    { value: "active", label: "Active cleaning" },
    { value: "monitoring", label: "Monitoring / follow-up" },
    { value: "paused", label: "Paused" },
    { value: "complete", label: "Complete" },
    { value: "not-tracked", label: "Not tracking" }
  ],
  cleaningStatuses: [
    { value: "", label: "Not assessed" },
    { value: "clean", label: "Clean" },
    { value: "needs-light-cleaning", label: "Needs light cleaning" },
    { value: "needs-deep-cleaning", label: "Needs deep cleaning" },
    { value: "damaged", label: "Damaged" },
    { value: "unreadable", label: "Unreadable" }
  ],
  familyRelations: [
    { value: "", label: "No relation set" },
    { value: "direct-ancestor", label: "Direct ancestor" },
    { value: "grandparent", label: "Grandparent" },
    { value: "parent", label: "Parent" },
    { value: "sibling", label: "Sibling" },
    { value: "spouse", label: "Spouse" },
    { value: "child", label: "Child" },
    { value: "extended-family", label: "Extended family" },
    { value: "research-interest", label: "Research interest" },
    { value: "not-related", label: "Not related" }
  ],
  visitPriorities: [
    { value: "", label: "No priority set" },
    { value: "high", label: "High" },
    { value: "medium", label: "Medium" },
    { value: "low", label: "Low" },
    { value: "complete", label: "Complete" }
  ],
  researchStatuses: [
    { value: "", label: "Not started" },
    { value: "needs-review", label: "Needs review" },
    { value: "in-progress", label: "In progress" },
    { value: "verified", label: "Verified" },
    { value: "blocked", label: "Blocked" }
  ]
};

module.exports = { CEMETERY_FIELD_OPTIONS, MEMORIAL_FIELD_OPTIONS };
