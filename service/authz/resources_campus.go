package authz

var CampusRead = Permission{Resource: "campus_partner", Action: ActionRead}
var CampusWrite = Permission{Resource: "campus_partner", Action: ActionWrite}

func init() {
	RegisterResource(ResourceDefinition{Resource: "campus_partner", LabelKey: "Campus Partner administration", Actions: []ActionDefinition{
		{Action: ActionRead, LabelKey: "View campus partner finances", DescriptionKey: "View campaign orders, refunds and payout recipients.", DefaultRoles: []string{BuiltInRoleAdmin}},
		{Action: ActionWrite, LabelKey: "Manage campus partner finances", DescriptionKey: "Configure the campaign, reconcile payments, register refunds and manage payouts.", DefaultRoles: []string{BuiltInRoleAdmin}},
	}})
}
