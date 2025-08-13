// @@@SNIPSTART temporal-ecommerce-worker
package main

import (
	"log"
	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/worker"
	"os"
	"temporal-ecommerce/app"
)

var (
	stripeKey         = os.Getenv("STRIPE_PRIVATE_KEY")
	resendApiKey      = os.Getenv("RESEND_API_KEY")
	resendFromEmail   = os.Getenv("RESEND_FROM_EMAIL")
	testEmail         = os.Getenv("TEST_EMAIL")
)

func main() {
	// Create the client object just once per process
	c, err := client.NewClient(client.Options{})
	if err != nil {
		log.Fatalln("unable to create Temporal client", err)
	}
	defer c.Close()
	// This worker hosts both Worker and Activity functions
	w := worker.New(c, "CART_TASK_QUEUE", worker.Options{})

	if stripeKey == "" {
		log.Fatalln("Must set STRIPE_PRIVATE_KEY environment variable")
	}
	if resendApiKey == "" {
		log.Fatalln("Must set RESEND_API_KEY environment variable")
	}
	if resendFromEmail == "" {
		log.Fatalln("Must set RESEND_FROM_EMAIL environment variable")
	}
	if testEmail == "" {
		log.Fatalln("Must set TEST_EMAIL environment variable")
	}

	a := &app.Activities{
		StripeKey: stripeKey,
		ResendApiKey: resendApiKey,
		ResendFromEmail: resendFromEmail,
		TestEmail: testEmail,
	}

	w.RegisterActivity(a.CreateStripeCharge)
	w.RegisterActivity(a.SendAbandonedCartEmail)

	w.RegisterWorkflow(app.CartWorkflow)
	// Start listening to the Task Queue
	err = w.Run(worker.InterruptCh())
	if err != nil {
		log.Fatalln("unable to start Worker", err)
	}
}
// @@@SNIPEND